#!/usr/bin/env python3
"""Validate the actual task container and paired reachable/blocked network controls."""
import argparse
import json
import subprocess
import sys
from urllib.parse import urlsplit


def docker(args, timeout=15):
    result = subprocess.run(["docker"] + args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise ValueError("Docker command failed: " + " ".join(args[:2]))
    return result.stdout


def check_configuration(data, networks):
    host = data.get("HostConfig", {})
    if not data.get("State", {}).get("Running"):
        raise ValueError("Task container is not running")
    if host.get("Privileged") or host.get("PidMode") == "host" or host.get("NetworkMode") == "host":
        raise ValueError("Privileged/host namespace task container")
    if any(str(c).upper().replace("CAP_", "") in ("SYS_ADMIN", "NET_ADMIN", "ALL") for c in host.get("CapAdd") or []):
        raise ValueError("Unsafe added capabilities")
    if host.get("Devices"):
        raise ValueError("Unexpected host devices")
    for mount in data.get("Mounts", []):
        if mount.get("Type") == "bind" or "docker.sock" in mount.get("Destination", ""):
            raise ValueError("Unexpected host bind or Docker socket mount")
    for env in data.get("Config", {}).get("Env", []):
        key, _, value = env.partition("=")
        if key.lower() in ("http_proxy", "https_proxy", "all_proxy", "docker_host") and value:
            raise ValueError("Task proxy or remote Docker endpoint could bypass isolation")
    attached = data.get("NetworkSettings", {}).get("Networks", {})
    if not attached or set(attached) != set(networks):
        raise ValueError("Task container networks differ from the declared isolation networks")
    if any(not n.get("Internal") for n in networks.values()):
        raise ValueError("All attached task networks must be internal")
    return True


def probe(container, url):
    if urlsplit(url).scheme not in ("http", "https"):
        raise ValueError("Only explicit HTTP(S) probes are supported")
    result = subprocess.run(["docker", "exec", container, "curl", "--noproxy", "*", "-sS", "-o", "/dev/null",
          "--connect-timeout", "2", "--max-time", "4", "-w", "%{http_code}", url],
          capture_output=True, text=True, timeout=10)
    return {"container": container, "url": url, "exit_code": result.returncode,
            "http_status": result.stdout.strip(), "reachable": result.returncode == 0 and result.stdout.strip() != "000"}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--network", action="append", required=True)
    parser.add_argument("--allowed-url", required=True)
    parser.add_argument("--blocked-url", action="append", required=True)
    parser.add_argument("--control-container", required=True)
    args=parser.parse_args()
    results=[]
    try:
        data=json.loads(docker(["inspect",args.container]))[0]
        networks={n:json.loads(docker(["network","inspect",n]))[0] for n in args.network}
        check_configuration(data,networks)
        allowed=probe(args.container,args.allowed_url);results.append(allowed)
        if not allowed["reachable"]: raise ValueError("Allowed target is not reachable")
        for url in args.blocked_url:
            control=probe(args.control_container,url);results.append(control)
            if not control["reachable"]: raise ValueError("Control cannot reach the same destination; invalid probe")
            denied=probe(args.container,url);results.append(denied)
            if denied["reachable"] or denied["exit_code"] not in (7,28):
                raise ValueError("Destination reached, or DNS/tool/TLS error mistaken for isolation")
        print(json.dumps({"passed":True,"container_id":data["Id"],"networks":list(networks),"probes":results},indent=2))
        return 0
    except (ValueError,OSError,subprocess.TimeoutExpired) as exc:
        print(json.dumps({"passed":False,"reason":str(exc),"probes":results},indent=2))
        return 1


if __name__ == '__main__': sys.exit(main())
