#!/usr/bin/env python3
"""Apply maintained API-contract patches to an archived frontend checkout."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


def apply_patches(source: Path, patches: Path) -> None:
    source, patches = source.resolve(), patches.resolve()
    if not source.is_dir():
        raise RuntimeError(f"Frontend source is not a directory: {source}")
    files = sorted(patches.glob("*.patch"))
    if not files:
        raise RuntimeError(f"No frontend patches found in {patches}")
    env = dict(os.environ)
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    # Archive build directories live inside the backend checkout. Do not let
    # Git discover that parent repository and interpret patch paths against it.
    env["GIT_CEILING_DIRECTORIES"] = str(source.parent)

    def git(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", "-C", str(source), "apply", "--whitespace=nowarn", *args],
            env=env, text=True, capture_output=True, check=False,
        )

    pending = []
    for patch in files:
        checked = git("--check", str(patch))
        if checked.returncode == 0:
            pending.append(str(patch))
        elif git("--reverse", "--check", str(patch)).returncode != 0:
            raise RuntimeError(
                f"Frontend patch no longer matches upstream: {patch.name}. "
                "Merge the contract fixes upstream or update the maintained patch.\n"
                + checked.stderr.strip()
            )
    if pending:
        checked = git("--check", *pending)
        if checked.returncode:
            raise RuntimeError("Frontend patches conflict; no source changed.\n" + checked.stderr.strip())
        applied = git(*pending)
        if applied.returncode:
            raise RuntimeError("Could not apply frontend patches.\n" + applied.stderr.strip())
    print(f"Frontend contract patches ready: {len(files)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--patches", type=Path, required=True)
    args = parser.parse_args()
    try:
        apply_patches(args.source, args.patches)
    except (OSError, RuntimeError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
