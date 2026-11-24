from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import subprocess
import wave
from pathlib import Path

import edge_tts
import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
SR = 48000


def ffmpeg() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def load_timeline(lang: str) -> tuple[Path, dict]:
    path = ROOT / f"timeline.{lang}.json"
    return path, json.loads(path.read_text(encoding="utf-8"))


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())


def read_wav_mono(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise RuntimeError(f"unexpected wav format: {path}")
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return data.astype(np.float32) / 32768.0


async def synthesize(text: str, out_mp3: Path, voice: str, rate: str, pitch: str) -> None:
    if out_mp3.exists() and out_mp3.stat().st_size > 4096:
        return
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    last_error = ""
    for attempt in range(4):
        try:
            comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume="+0%")
            await comm.save(str(out_mp3))
            if out_mp3.exists() and out_mp3.stat().st_size > 4096:
                return
            last_error = "empty or truncated output"
        except Exception as exc:
            last_error = str(exc)
        print(f"  tts retry {attempt + 1}: {last_error}")
        await asyncio.sleep(1.2 + attempt)
    raise RuntimeError(f"tts failed: {text} ({last_error})")


def mp3_to_wav(mp3: Path, wav: Path) -> None:
    if wav.exists() and wav.stat().st_size > 8192:
        return
    cmd = [
        ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(mp3), "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(wav),
    ]
    subprocess.run(cmd, check=True)


async def build_voices(lang: str, tl: dict) -> list[Path]:
    out_dir = BUILD / lang / "audio"
    out_dir.mkdir(parents=True, exist_ok=True)
    wavs = []
    for scene in tl["scenes"]:
        key = hashlib.sha1(
            f"{scene['vo']}|{tl['voice']}|{tl['rate']}|{tl['pitch']}".encode("utf-8")
        ).hexdigest()[:12]
        mp3 = out_dir / f"{scene['id']}-{key}.mp3"
        wav = out_dir / f"{scene['id']}-{key}.wav"
        print(f"  {scene['id']} tts")
        await synthesize(scene["vo"], mp3, tl["voice"], tl["rate"], tl["pitch"])
        mp3_to_wav(mp3, wav)
        duration = wav_duration(wav)
        if duration < 0.5:
            raise RuntimeError(f"voice too short: {wav} ({duration:.2f}s)")
        wavs.append(wav)
    return wavs


def compute_timeline(tl: dict, wavs: list[Path]) -> None:
    cursor = 0.0
    for scene, wav in zip(tl["scenes"], wavs):
        audio = wav_duration(wav)
        dur = max(float(scene["min"]), audio + 1.15)
        scene["audio"] = round(audio, 3)
        scene["start"] = round(cursor, 3)
        scene["dur"] = round(dur, 3)
        scene["vo_at"] = 0.62
        cursor += dur
    tl["total"] = round(cursor, 3)


def _pad_chord(freqs: list[float], dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    out = np.zeros((n, 2), np.float32)
    for j, f in enumerate(freqs):
        lfo = 0.74 + 0.26 * np.sin(2 * np.pi * (0.052 + j * 0.014) * t + j * 1.9)
        for k, det in enumerate((-0.0015, 0.0015)):
            ff = f * (1 + det)
            tone = (
                np.sin(2 * np.pi * ff * t + j * 0.8 + k * 0.4)
                + 0.30 * np.sin(2 * np.pi * 2 * ff * t + 0.7)
                + 0.08 * np.sin(2 * np.pi * 3 * ff * t + 1.3)
            ) * lfo * (0.15 if j == 0 else 0.095)
            pan = 0.5 + (0.27 if (j + k) % 2 == 0 else -0.27)
            out[:, 0] += tone * (1 - pan) * 1.4
            out[:, 1] += tone * pan * 1.4
    return out


def build_music(total: float, scene_starts: list[float]) -> tuple[np.ndarray, np.ndarray]:
    n = int(math.ceil(total * SR))
    rng = np.random.default_rng(1219)
    music = np.zeros((n, 2), np.float32)
    chords = [
        [110.00, 130.81, 164.81],
        [87.31, 130.81, 174.61],
        [130.81, 164.81, 196.00],
        [98.00, 123.47, 146.83],
    ]
    bar = 5.6
    cross = 0.9
    bars = int(math.ceil(total / bar)) + 1
    for i in range(bars):
        seg = _pad_chord(chords[i % 4], bar + cross)
        start = int(i * bar * SR)
        if start >= n:
            break
        end = min(n, start + len(seg))
        seg = seg[: end - start]
        m = len(seg)
        env = np.ones(m, np.float32)
        ci = min(int(cross * SR), m // 2)
        if ci > 1:
            ramp = np.sin(np.linspace(0, np.pi / 2, ci, dtype=np.float32)) ** 2
            env[:ci] = ramp
            env[-ci:] = ramp[::-1]
        music[start:end] += seg * env[:, None]

    t = np.arange(n, dtype=np.float32) / SR
    drone_env = 0.55 + 0.45 * np.sin(2 * np.pi * 0.029 * t - 0.8)
    drone = np.sin(2 * np.pi * 55.0 * t) * 0.050 * drone_env
    music[:, 0] += drone
    music[:, 1] += drone

    low_rate = 6000
    nl = int(total * low_rate) + 1
    kernel = np.hanning(64).astype(np.float32)
    kernel /= kernel.sum()
    tl = np.arange(nl, dtype=np.float32) / low_rate
    for ch in range(2):
        air = rng.normal(0, 1, nl).astype(np.float32)
        air = np.convolve(air, kernel, mode="same")
        air = np.interp(t, tl, air).astype(np.float32)
        music[:, ch] += air * (0.016 if ch == 0 else 0.014)

    for beat in np.arange(1.2, total - 0.4, 2.0):
        start = int(beat * SR)
        length = min(int(0.40 * SR), n - start)
        if length <= 0:
            continue
        bt = np.arange(length, dtype=np.float32) / SR
        env = np.exp(-bt * 14.0)
        thump = (np.sin(2 * np.pi * 52 * bt) + 0.22 * np.sin(2 * np.pi * 91 * bt)) * env * 0.070
        music[start:start + length] += thump[:, None]

    sfx = np.zeros((n, 2), np.float32)
    for scene_start in scene_starts[1:]:
        length = int(0.95 * SR)
        start = int((scene_start - 0.30) * SR)
        if start < 0 or start >= n:
            continue
        length = min(length, n - start)
        wt = np.arange(length, dtype=np.float32) / SR
        env = np.sin(np.pi * np.clip(wt / 0.95, 0, 1)) ** 2
        sweep = np.sin(2 * np.pi * (220 * wt + 680 * wt * wt))
        noise = rng.normal(0, 1, length).astype(np.float32)
        noise = np.convolve(noise, np.hanning(20) / np.hanning(20).sum(), mode="same")
        sig = (noise * 0.74 + sweep * 0.11) * env * 0.095
        sfx[start:start + length, 0] += sig
        sfx[start:start + length, 1] += sig * 0.92

    music += sfx
    music = music / max(1e-6, float(np.max(np.abs(music)))) * 0.58
    return music, t


def build_mix(lang: str, tl: dict, wavs: list[Path]) -> Path:
    total = float(tl["total"])
    n = int(math.ceil(total * SR))
    voice = np.zeros(n, np.float32)
    for scene, wav in zip(tl["scenes"], wavs):
        data = read_wav_mono(wav)
        start = int(round((scene["start"] + scene["vo_at"]) * SR))
        end = min(n, start + len(data))
        if end > start:
            voice[start:end] += data[: end - start]

    music, _ = build_music(total, [s["start"] for s in tl["scenes"]])
    music = music[:n]
    bed = music * 0.20
    mix = np.zeros((n, 2), np.float32)
    mix[:, 0] = voice * 0.94 + bed[:, 0]
    mix[:, 1] = voice * 0.94 + bed[:, 1]

    fade_in = min(int(0.45 * SR), n)
    if fade_in:
        mix[:fade_in] *= np.linspace(0, 1, fade_in, dtype=np.float32)[:, None]
    fade_out = min(int(1.3 * SR), n)
    if fade_out:
        mix[-fade_out:] *= np.linspace(1, 0, fade_out, dtype=np.float32)[:, None]

    peak = float(np.max(np.abs(mix)))
    if peak > 0:
        mix = mix / peak * 0.89
    pcm = np.clip(mix * 32767.0, -32768, 32767).astype(np.int16)
    out = BUILD / lang / "mix.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["zh", "en", "all"], default="all")
    args = parser.parse_args()
    langs = ["zh", "en"] if args.lang == "all" else [args.lang]
    for lang in langs:
        print(f"[{lang}] voices")
        path, tl = load_timeline(lang)
        wavs = asyncio.run(build_voices(lang, tl))
        compute_timeline(tl, wavs)
        path.write_text(json.dumps(tl, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        mix = build_mix(lang, tl, wavs)
        print(f"[{lang}] total={tl['total']:.3f}s mix={mix}")
        for scene in tl["scenes"]:
            print(f"  {scene['id']} start={scene['start']:.2f} "
                  f"dur={scene['dur']:.2f} audio={scene['audio']:.2f}")


if __name__ == "__main__":
    main()
