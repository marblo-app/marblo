#!/usr/bin/env python3
"""
온보딩 프리뷰 녹화(raw.webm + marks.json) → GIF·mp4 두 길이 인코딩
(티켓 l14I6AhpUBzyD8zqYoW1). ffmpeg 8.x.

  python3 tests/playwright/manual/record-onboarding-encode.py [OUT_DIR]

입력: OUT_DIR/raw.webm, OUT_DIR/marks.json (record-onboarding-preview.spec.ts 산출)
출력: OUT_DIR/onboarding-short.{gif,mp4}, OUT_DIR/onboarding-full.{gif,mp4},
      OUT_DIR/encode-report.json (길이·용량·배속·구간)

★재생 속도는 대본(실측 튜닝값)을 건드리지 않는다. 짧은 컷이 15초를 넘을 때만
  **인코딩 단계에서** setpts 배속을 주고, 그 배속을 리포트에 적는다.
★GIF 는 X 업로드 한도(15MB) 안에 들도록 fps·폭·팔레트를 단계적으로 줄인다.
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

GIF_LIMIT = 15 * 1024 * 1024
SHORT_MAX_S = 15.0
# 짧은 컷: 연결 게이트 → 모달 "연결됐어요"(done) 까지. 설치→로그인 핵심만.
SHORT_FROM, SHORT_TO = "scene_connect_gate", "modal_done"
FULL_FROM, FULL_TO = "scene_connect_gate", "end"
LEAD_S = 0.0    # 장면 마크는 정지 화면 앞에 찍히므로 여유 불필요
TAIL_S = 1.0    # 마크 뒤 여유(완료 문구를 한 박자 보여준다)


def run(cmd: list[str]) -> str:
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def probe_duration(path: Path) -> float:
    out = run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
    ])
    return float(out.strip())


def detect_scene_changes(path: Path, threshold: float = 0.08) -> list[float]:
    """큰 화면 전환의 pts(초). 임계값은 모달 열림/닫힘이 잡히는 수준으로 둔다."""
    proc = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(path),
        "-vf", f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-",
    ], capture_output=True, text=True)
    out: list[float] = []
    for line in proc.stderr.splitlines():
        if "pts_time:" in line:
            try:
                out.append(float(line.split("pts_time:")[1].split()[0]))
            except ValueError:
                pass
    return out


def encode_mp4(src: Path, dst: Path, start: float, end: float, speed: float) -> None:
    vf = f"setpts=PTS/{speed:.4f},fps=30,scale=1280:-2"
    run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src),
        "-vf", vf, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst),
    ])


def encode_gif(src: Path, dst: Path, start: float, end: float, speed: float) -> dict:
    # 단계적 축소: (fps, 폭, 색수). 첫 단계가 15MB 안에 들면 거기서 멈춘다.
    ladder = [
        (15, 1024, 256), (12, 960, 256), (12, 900, 192), (10, 840, 160),
        (10, 800, 128), (8, 720, 128), (8, 640, 96),
    ]
    for fps, width, colors in ladder:
        pre = f"setpts=PTS/{speed:.4f},fps={fps},scale={width}:-1:flags=lanczos"
        vf = (
            f"{pre},split[a][b];[a]palettegen=max_colors={colors}:stats_mode=diff[p];"
            f"[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle"
        )
        run([
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src),
            "-filter_complex", vf, "-loop", "0", str(dst),
        ])
        size = dst.stat().st_size
        if size <= GIF_LIMIT:
            return {"fps": fps, "width": width, "colors": colors, "bytes": size}
    raise SystemExit(f"GIF 가 15MB 를 넘는다: {dst} ({size} bytes)")


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else
                   Path(__file__).resolve().parents[3] / "test-results" / "onboarding-recording")
    src = out_dir / "raw.webm"
    marks_file = out_dir / "marks.json"
    meta = json.loads(marks_file.read_text())
    duration = probe_duration(src)
    # 영상은 close 시점에 끝난다 → 시작 = closedAt - duration.
    video_start_ms = meta["closedAt"] - duration * 1000.0
    at = {m["name"]: (m["at"] - video_start_ms) / 1000.0 for m in meta["marks"]}
    launch_gap = (meta["launchedAt"] - video_start_ms) / 1000.0
    print(f"[encode] raw={duration:.2f}s  launch→videoStart 오차={launch_gap:+.2f}s")
    # ★벽시계 역산은 0.1~0.5초쯤 어긋난다(Playwright 녹화의 프레임 타이밍). 모달이
    # 열리는 순간은 화면이 크게 바뀌는 장면 전환이라 ffmpeg scene 검출로 잡히므로,
    # 그 시각을 앵커로 모든 마크를 같은 양만큼 보정한다.
    scene_times = detect_scene_changes(src)
    anchor = at.get("modal_open")
    delta = 0.0
    if anchor is not None and scene_times:
        near = min(scene_times, key=lambda t: abs(t - anchor))
        if abs(near - anchor) <= 1.5:
            delta = near - anchor
    at = {k: v + delta for k, v in at.items()}
    print(f"[encode] scene anchor(modal_open) 보정 δ={delta:+.2f}s  scene={scene_times}")

    def clip(a: str, b: str) -> tuple[float, float]:
        s = max(0.0, at[a] - LEAD_S)
        e = min(duration, at[b] + TAIL_S)
        return s, e

    report: dict = {"raw_seconds": round(duration, 2), "scene_anchor_delta_s": round(delta, 2), "marks_seconds": {k: round(v, 2) for k, v in at.items()}, "clips": {}}

    jobs = {
        "short": clip(SHORT_FROM, SHORT_TO),
        "full": clip(FULL_FROM, FULL_TO),
    }
    for name, (s, e) in jobs.items():
        real_len = e - s
        speed = 1.0
        if name == "short" and real_len > SHORT_MAX_S:
            # 15초 안에 넣기 위한 최소 배속(0.05 단위 올림). 대본이 아니라 인코딩 배속.
            speed = math.ceil((real_len / (SHORT_MAX_S - 0.3)) * 20) / 20
        if name == "full":
            speed = float(os.environ.get("FULL_SPEED", "1.0"))
        mp4 = out_dir / f"onboarding-{name}.mp4"
        gif = out_dir / f"onboarding-{name}.gif"
        encode_mp4(src, mp4, s, e, speed)
        gif_info = encode_gif(src, gif, s, e, speed)
        report["clips"][name] = {
            "from_mark": SHORT_FROM if name == "short" else FULL_FROM,
            "to_mark": SHORT_TO if name == "short" else FULL_TO,
            "source_range_s": [round(s, 2), round(e, 2)],
            "source_len_s": round(real_len, 2),
            "encode_speed": speed,
            "mp4": {"path": str(mp4), "seconds": round(probe_duration(mp4), 2), "bytes": mp4.stat().st_size},
            "gif": {"path": str(gif), "seconds": round(probe_duration(gif), 2), **gif_info},
        }
        print(f"[encode] {name}: src {s:.2f}→{e:.2f} ({real_len:.2f}s) speed×{speed} "
              f"mp4={mp4.stat().st_size/1e6:.2f}MB gif={gif_info['bytes']/1e6:.2f}MB "
              f"({gif_info['fps']}fps/{gif_info['width']}px/{gif_info['colors']}c)")
    (out_dir / "encode-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
