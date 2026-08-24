/**
 * Local speech-to-text.
 *
 * Deliberately local-only. The obvious shortcut — the browser's
 * SpeechRecognition API — streams captured audio to Google's servers in
 * Chromium and Electron, which would quietly turn a local-first agent into one
 * that sends your voice off the machine. So this looks for a recogniser
 * installed on the user's own system and uses that, and when there is none it
 * reports that plainly.
 *
 * It never invents a transcript. A fabricated transcript is worse than no
 * transcript, because the agent then acts on words nobody said.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TranscriptionResult {
  /** Recognised text, or null when nothing could be recognised. */
  text: string | null;
  /** Which local engine produced it, for the UI to be honest about. */
  engine: string | null;
  /** Set when transcription could not be attempted at all. */
  error?: string;
}

/** Engines we know how to drive, in preference order. */
const ENGINES = [
  {
    name: 'whisper.cpp',
    /** whisper-cli (current) and main (older builds) take the same flags. */
    bins: ['whisper-cli', 'whisper.cpp', 'whisper'],
    run: (bin: string, wav: string): string => {
      const model = process.env.NEUROCLAW_WHISPER_MODEL;
      const args = ['-f', wav, '-nt', '-otxt', '-of', wav];
      if (model) args.unshift('-m', model);
      execFileSync(bin, args, { timeout: 120_000, stdio: 'ignore' });
      const out = `${wav}.txt`;
      return existsSync(out) ? readFileSync(out, 'utf8') : '';
    },
  },
  {
    name: 'vosk',
    bins: ['vosk-transcriber'],
    run: (bin: string, wav: string): string =>
      execFileSync(bin, ['-i', wav], { timeout: 120_000, encoding: 'utf8' }),
  },
] as const;

function which(bin: string): string | null {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  if (probe.status !== 0) return null;
  const first = (probe.stdout || '').split(/\r?\n/).find(Boolean);
  return first ? first.trim() : null;
}

/** The first installed engine, or null when the machine has none. */
export function findLocalEngine(): { name: string; bin: string; run: (bin: string, wav: string) => string } | null {
  for (const engine of ENGINES) {
    for (const bin of engine.bins) {
      const resolved = which(bin);
      if (resolved) return { name: engine.name, bin: resolved, run: engine.run };
    }
  }
  return null;
}

/**
 * Convert recorded audio to 16kHz mono WAV, which is what both engines expect.
 * Returns null when ffmpeg is unavailable or the input is not decodable.
 */
function toWav(input: Buffer, dir: string): string | null {
  const ffmpeg = which('ffmpeg');
  if (!ffmpeg) return null;
  const src = join(dir, 'input.bin');
  const wav = join(dir, 'audio.wav');
  writeFileSync(src, input);
  const conv = spawnSync(ffmpeg, ['-y', '-i', src, '-ar', '16000', '-ac', '1', wav], {
    timeout: 60_000,
    stdio: 'ignore',
  });
  if (conv.status !== 0 || !existsSync(wav)) return null;
  return wav;
}

/**
 * Transcribe recorded audio using a locally installed engine.
 *
 * @param audio Raw bytes as recorded by the browser (webm/ogg/wav).
 */
export function transcribeAudio(audio: Buffer): TranscriptionResult {
  if (audio.length === 0) {
    return { text: null, engine: null, error: 'Empty recording.' };
  }

  const engine = findLocalEngine();
  if (!engine) {
    return {
      text: null,
      engine: null,
      error:
        'No local speech recogniser is installed. Install whisper.cpp (whisper-cli) or vosk-transcriber ' +
        'and it will be used automatically. Speech is never sent off this machine, so a local engine is required.',
    };
  }

  const dir = mkdtempSync(join(tmpdir(), 'neuroclaw-stt-'));
  try {
    const wav = toWav(audio, dir);
    if (!wav) {
      return {
        text: null,
        engine: engine.name,
        error: 'ffmpeg is required to decode the recording, and was not found on this machine.',
      };
    }
    const raw = engine.run(engine.bin, wav);
    const text = raw
      .replace(/\[[0-9:.\s>-]+\]/g, '') // whisper timestamp prefixes when -nt is unsupported
      .trim();
    return text ? { text, engine: engine.name } : { text: null, engine: engine.name };
  } catch (e) {
    return {
      text: null,
      engine: engine.name,
      error: `Local transcription failed: ${(e as Error).message}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
