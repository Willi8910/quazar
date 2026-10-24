//! CPU and memory of each tab: its shell plus everything running under it (agents, k9s, …),
//! read from one process snapshot (`ps` on macOS, `sysinfo` on Windows).

use std::collections::HashMap;

use serde::Serialize;
use tauri::State;

use crate::pty::Ptys;

#[cfg(unix)]
use self::unix::{command_lines, listening_ports, signal, snapshot, total_memory};
#[cfg(windows)]
use self::windows::{command_lines, kill, listening_ports, snapshot, total_memory};

struct Proc {
    ppid: u32,
    /// Percent of one core, as `ps` reports it.
    cpu: f32,
    /// Resident memory in KiB.
    rss: u64,
    name: String,
}

/// `root` and all its descendants.
fn tree(procs: &HashMap<u32, Proc>, root: u32) -> Vec<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&pid, p) in procs {
        children.entry(p.ppid).or_default().push(pid);
    }
    let mut out = vec![root];
    let mut i = 0;
    while i < out.len() {
        out.extend(children.get(&out[i]).into_iter().flatten().copied());
        i += 1;
    }
    out.retain(|pid| procs.contains_key(pid));
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Percent of one core (can exceed 100 on a multi-core machine).
    cpu: f32,
    /// Resident memory in bytes.
    memory: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabUsage {
    tab_id: String,
    #[serde(flatten)]
    usage: Usage,
    processes: usize,
    /// The busiest program under the shell (by CPU, then memory), e.g. "claude".
    top: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    tabs: Vec<TabUsage>,
    /// Quazar's own process.
    app: Usage,
    cores: usize,
    /// Physical memory in bytes.
    total_memory: u64,
}

fn usage(procs: &HashMap<u32, Proc>, pids: &[u32]) -> Usage {
    Usage {
        cpu: pids.iter().map(|p| procs[p].cpu).sum(),
        memory: pids.iter().map(|p| procs[p].rss * 1024).sum(),
    }
}

#[tauri::command]
pub async fn process_metrics(ptys: State<'_, Ptys>) -> Result<Metrics, String> {
    let roots = ptys.root_pids();
    let procs = snapshot();
    let tabs = roots
        .into_iter()
        .map(|(tab_id, root)| {
            let pids = tree(&procs, root);
            let top = pids
                .iter()
                .skip(1)
                .map(|p| &procs[p])
                .max_by(|a, b| a.cpu.total_cmp(&b.cpu).then(a.rss.cmp(&b.rss)))
                .map(|p| p.name.clone());
            TabUsage { tab_id, usage: usage(&procs, &pids), processes: pids.len(), top }
        })
        .collect();
    let me: Vec<u32> = [std::process::id()].into_iter().filter(|p| procs.contains_key(p)).collect();
    Ok(Metrics {
        tabs,
        app: usage(&procs, &me),
        cores: std::thread::available_parallelism().map_or(1, |n| n.get()),
        total_memory: total_memory(),
    })
}

/// One process in a tab, for the detailed view.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pid: u32,
    /// How deep under the tab's shell (the shell is 0).
    depth: usize,
    name: String,
    /// Full command line.
    command: String,
    #[serde(flatten)]
    usage: Usage,
    /// TCP ports it listens on (servers).
    ports: Vec<u16>,
}

/// `root` and its descendants depth-first (parents before children), with their depth.
fn tree_order(procs: &HashMap<u32, Proc>, root: u32) -> Vec<(u32, usize)> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for (&pid, p) in procs {
        children.entry(p.ppid).or_default().push(pid);
    }
    let mut out = Vec::new();
    let mut stack = vec![(root, 0)];
    while let Some((pid, depth)) = stack.pop() {
        if !procs.contains_key(&pid) {
            continue;
        }
        out.push((pid, depth));
        let mut kids = children.get(&pid).cloned().unwrap_or_default();
        kids.sort_unstable_by(|a, b| b.cmp(a)); // popped in ascending pid order
        stack.extend(kids.into_iter().map(|k| (k, depth + 1)));
    }
    out
}

/// `lsof -F pn` output: a `p<pid>` line, then `n<address>:<port>` lines for that process.
#[cfg(any(unix, test))]
fn parse_lsof(text: &str) -> HashMap<u32, Vec<u16>> {
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    let mut pid = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().ok();
        } else if let (Some(addr), Some(pid)) = (line.strip_prefix('n'), pid) {
            if let Some(port) = addr.rsplit(':').next().and_then(|p| p.parse().ok()) {
                let ports = out.entry(pid).or_default();
                if !ports.contains(&port) {
                    ports.push(port);
                }
            }
        }
    }
    out
}

/// `netstat -ano -p TCP` output: the listening ports of each process.
#[cfg(any(windows, test))]
fn parse_netstat(text: &str) -> HashMap<u32, Vec<u16>> {
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    for line in text.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        let [proto, local, _, state, pid] = words.as_slice() else { continue };
        if !proto.starts_with("TCP") || *state != "LISTENING" {
            continue;
        }
        let (Some(port), Ok(pid)) = (local.rsplit(':').next().and_then(|p| p.parse().ok()), pid.parse()) else {
            continue;
        };
        let ports = out.entry(pid).or_default();
        if !ports.contains(&port) {
            ports.push(port);
        }
    }
    out
}

/// Every process in a tab (its shell and all under it), with full command lines and listening ports.
#[tauri::command]
pub async fn tab_processes(ptys: State<'_, Ptys>, tab_id: String) -> Result<Vec<ProcessInfo>, String> {
    let root = ptys.root_pids().into_iter().find(|(id, _)| *id == tab_id).map(|(_, pid)| pid);
    let Some(root) = root else { return Ok(Vec::new()) };
    let procs = snapshot();
    let order = tree_order(&procs, root);
    let pids: Vec<u32> = order.iter().map(|(pid, _)| *pid).collect();
    let commands = command_lines(&pids);
    let mut ports = listening_ports(&pids);
    Ok(order
        .into_iter()
        .map(|(pid, depth)| {
            let p = &procs[&pid];
            ProcessInfo {
                pid,
                depth,
                name: p.name.clone(),
                command: commands.get(&pid).cloned().unwrap_or_else(|| p.name.clone()),
                usage: usage(&procs, &[pid]),
                ports: ports.remove(&pid).unwrap_or_default(),
            }
        })
        .collect())
}

/// Stops one process in a tab (e.g. a runaway dev server), leaving the rest running.
#[tauri::command]
pub fn stop_process(ptys: State<'_, Ptys>, tab_id: String, pid: u32) -> Result<(), String> {
    let root = ptys.root_pids().into_iter().find(|(id, _)| *id == tab_id).map(|(_, pid)| pid);
    let root = root.ok_or("the tab isn't running")?;
    // Only processes of this tab, and never its shell (Stop on the tab does that).
    if pid == root || !tree(&snapshot(), root).contains(&pid) {
        return Err("not a process of this tab".into());
    }
    #[cfg(unix)]
    let stopped = signal("-TERM", &[pid]);
    #[cfg(windows)]
    let stopped = kill(&[pid]);
    stopped.then_some(()).ok_or_else(|| format!("couldn't stop process {pid}"))
}

/// Stops everything running in a tab: its programs get SIGTERM (agents save their session and
/// exit), the shell a hangup; whatever is still alive two seconds later is killed. Windows has no
/// such signals: everything is ended at once.
#[cfg(windows)]
pub fn terminate_tree(root: u32) {
    let mut pids = tree(&snapshot(), root);
    pids.reverse(); // the shell last
    kill(&pids);
}

#[cfg(unix)]
pub fn terminate_tree(root: u32) {
    let procs = snapshot();
    let pids = tree(&procs, root);
    if pids.is_empty() {
        return;
    }
    signal("-TERM", &pids[1..]);
    signal("-HUP", &pids[..1]);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let alive = snapshot();
        // Only processes that are still the same ones (same parent) — pids can be reused.
        let left: Vec<u32> =
            pids.iter().copied().filter(|p| alive.get(p).is_some_and(|a| a.ppid == procs[p].ppid)).collect();
        signal("-KILL", &left);
    });
}

#[cfg(unix)]
mod unix {
    use std::collections::HashMap;
    use std::process::Command;
    use std::sync::OnceLock;

    use super::{parse_lsof, Proc};

    /// Every process by pid.
    pub(super) fn snapshot() -> HashMap<u32, Proc> {
        let Ok(out) = Command::new("ps").args(["-A", "-o", "pid=,ppid=,pcpu=,rss=,comm="]).output() else {
            return HashMap::new();
        };
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let mut words = line.split_whitespace();
                let pid = words.next()?.parse().ok()?;
                let ppid = words.next()?.parse().ok()?;
                let cpu = words.next()?.replace(',', ".").parse().ok()?;
                let rss = words.next()?.parse().ok()?;
                let command = words.collect::<Vec<_>>().join(" ");
                let name = command.rsplit('/').next().unwrap_or(&command).to_string();
                Some((pid, Proc { ppid, cpu, rss, name }))
            })
            .collect()
    }

    pub(super) fn total_memory() -> u64 {
        static TOTAL: OnceLock<u64> = OnceLock::new();
        *TOTAL.get_or_init(|| {
            Command::new("sysctl")
                .args(["-n", "hw.memsize"])
                .output()
                .ok()
                .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse().ok())
                .unwrap_or(0)
        })
    }

    /// Full command lines of `pids`.
    pub(super) fn command_lines(pids: &[u32]) -> HashMap<u32, String> {
        let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let Ok(out) = Command::new("ps").args(["-o", "pid=,args=", "-p", &list]).output() else {
            return HashMap::new();
        };
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|line| {
                let line = line.trim_start();
                let (pid, args) = line.split_once(' ')?;
                Some((pid.parse().ok()?, args.trim().to_string()))
            })
            .collect()
    }

    /// TCP ports each of `pids` listens on.
    pub(super) fn listening_ports(pids: &[u32]) -> HashMap<u32, Vec<u16>> {
        let list = pids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let Ok(out) =
            Command::new("lsof").args(["-nP", "-a", "-iTCP", "-sTCP:LISTEN", "-p", &list, "-Fpn"]).output()
        else {
            return HashMap::new();
        };
        parse_lsof(&String::from_utf8_lossy(&out.stdout))
    }

    /// Sends `sig` (e.g. "-TERM") to `pids`.
    pub(super) fn signal(sig: &str, pids: &[u32]) -> bool {
        !pids.is_empty()
            && Command::new("kill").arg(sig).args(pids.iter().map(u32::to_string)).status().is_ok_and(|s| s.success())
    }
}

#[cfg(windows)]
mod windows {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    use super::{parse_netstat, Proc};
    use crate::platform::command;

    /// Kept between snapshots: CPU use is measured from one refresh to the next.
    static SYSTEM: Mutex<Option<System>> = Mutex::new(None);

    fn with_system<T>(f: impl FnOnce(&mut System) -> T) -> T {
        let mut system = SYSTEM.lock().unwrap();
        f(system.get_or_insert_with(System::new))
    }

    /// Every process by pid.
    pub(super) fn snapshot() -> HashMap<u32, Proc> {
        with_system(|sys| {
            let kind = ProcessRefreshKind::nothing().with_cpu().with_memory();
            sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
            sys.processes()
                .iter()
                .map(|(pid, p)| {
                    let proc = Proc {
                        ppid: p.parent().map_or(0, Pid::as_u32),
                        cpu: p.cpu_usage(),
                        rss: p.memory() / 1024,
                        name: p.name().to_string_lossy().trim_end_matches(".exe").to_string(),
                    };
                    (pid.as_u32(), proc)
                })
                .collect()
        })
    }

    pub(super) fn total_memory() -> u64 {
        with_system(|sys| {
            if sys.total_memory() == 0 {
                sys.refresh_memory();
            }
            sys.total_memory()
        })
    }

    /// Full command lines of `pids`.
    pub(super) fn command_lines(pids: &[u32]) -> HashMap<u32, String> {
        with_system(|sys| {
            let pids: Vec<Pid> = pids.iter().map(|&p| Pid::from_u32(p)).collect();
            let kind = ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet);
            sys.refresh_processes_specifics(ProcessesToUpdate::Some(&pids), false, kind);
            pids.iter()
                .filter_map(|pid| {
                    let cmd = sys.process(*pid)?.cmd();
                    let line = cmd.iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ");
                    (!line.is_empty()).then(|| (pid.as_u32(), line))
                })
                .collect()
        })
    }

    /// TCP ports each of `pids` listens on.
    pub(super) fn listening_ports(pids: &[u32]) -> HashMap<u32, Vec<u16>> {
        let Ok(out) = command("netstat").args(["-ano", "-p", "TCP"]).output() else {
            return HashMap::new();
        };
        let mut ports = parse_netstat(&String::from_utf8_lossy(&out.stdout));
        ports.retain(|pid, _| pids.contains(pid));
        ports
    }

    /// Ends `pids` right away (Windows has no gentler signal for console programs).
    pub(super) fn kill(pids: &[u32]) -> bool {
        with_system(|sys| {
            let mut all = !pids.is_empty();
            for pid in pids {
                all &= sys.process(Pid::from_u32(*pid)).is_some_and(|p| p.kill());
            }
            all
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(ppid: u32) -> Proc {
        Proc { ppid, cpu: 1.5, rss: 10, name: "x".into() }
    }

    #[test]
    fn orders_a_tree_parents_first() {
        let procs = HashMap::from([(10, proc(1)), (12, proc(10)), (11, proc(10)), (13, proc(11)), (20, proc(1))]);
        assert_eq!(tree_order(&procs, 10), [(10, 0), (11, 1), (13, 2), (12, 1)]);
    }

    #[test]
    fn reads_listening_ports_from_lsof() {
        let ports = parse_lsof("p100\nn*:3000\nn127.0.0.1:3000\nn[::1]:9229\np200\nn*:5432\n");
        assert_eq!(ports[&100], [3000, 9229]);
        assert_eq!(ports[&200], [5432]);
    }

    #[test]
    fn reads_listening_ports_from_netstat() {
        let text = "\nActive Connections\n\n  Proto  Local Address  Foreign Address  State  PID\n  \
            TCP    0.0.0.0:3000   0.0.0.0:0   LISTENING   100\n  \
            TCP    [::]:3000      [::]:0      LISTENING   100\n  \
            TCP    127.0.0.1:5000 127.0.0.1:6000 ESTABLISHED 100\n  \
            TCP    127.0.0.1:5432 0.0.0.0:0   LISTENING   200\n";
        let ports = parse_netstat(text);
        assert_eq!(ports[&100], [3000]);
        assert_eq!(ports[&200], [5432]);
    }

    #[test]
    fn collects_a_process_tree() {
        let procs = HashMap::from([(10, proc(1)), (11, proc(10)), (12, proc(11)), (13, proc(1))]);
        let mut pids = tree(&procs, 10);
        pids.sort();
        assert_eq!(pids, [10, 11, 12]);
        let u = usage(&procs, &pids);
        assert_eq!((u.cpu, u.memory), (4.5, 30 * 1024));
        assert!(tree(&procs, 99).is_empty());
    }

    #[test]
    fn reads_the_live_process_list() {
        let procs = snapshot();
        assert!(procs.contains_key(&std::process::id()));
    }
}
