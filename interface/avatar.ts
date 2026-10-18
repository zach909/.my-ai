/**
 * The avatar: a small floating window you talk to.
 *
 * What it is: the ring and the glowing sphere (the shared look, ambient.ts) as
 * a character. The ring speeds up and the sphere swells while you speak and
 * while it speaks. Under it: a mic button, a text box, and what was said.
 *
 * How it hears you: the microphone's sound goes into the mesh as the raw bytes
 * it is (8-bit, 8 kHz, through the "voice" doorway). Nothing transcribes it, so
 * there is no speech-to-text anywhere. The mesh has to learn what sound means.
 *
 * How it talks back: what the mesh writes (the chat reply) is spoken by the
 * computer's own built-in voice, and the avatar moves with that speech. Any
 * sound the mesh itself puts out on the "voice" doorway is played as the raw
 * 8-bit 8 kHz sound it is. Pictures the mesh puts out on the "face" doorway
 * (raw 32x32 pixels, RGBA) are drawn on the sphere.
 *
 * The honest limit: a doorway carries about three bytes a second, and speech
 * at 8 kHz is 8000 bytes a second. So only the first moments of what you say
 * reach the mesh (VOICE_MAX_BYTES), and the mesh cannot speak in real time.
 * The page says so rather than pretending.
 */

export const VOICE_RATE = 8000;
export const VOICE_MAX_BYTES = 256;
export const FACE_SIZE = 32;

/** Microphone samples (-1..1 at `fromRate`) as 8-bit unsigned sound at `toRate`, at most `maxBytes` of it. */
export function pcmToBytes(samples: ArrayLike<number>, fromRate: number, toRate: number = VOICE_RATE, maxBytes: number = VOICE_MAX_BYTES): Uint8Array {
  const step = fromRate / toRate;
  const total = Math.min(maxBytes, Math.floor(samples.length / step));
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let k = from; k < to && k < samples.length; k++) sum += samples[k];
    const v = Math.max(-1, Math.min(1, sum / (to - from)));
    out[i] = Math.round((v + 1) * 127.5);
  }
  return out;
}

/** 8-bit unsigned sound back to samples (-1..1). */
export function bytesToPcm(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] / 127.5 - 1;
  return out;
}

export const AVATAR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Corona</title>
<style>
  html { clip-path: inset(0 round 36px); background: transparent; }
  body { margin: 0; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  #bar { -webkit-app-region: drag; display: flex; justify-content: space-between; align-items: center; padding: 14px 22px 0; font-size: 13px; position: relative; z-index: 2; }
  #bar button { -webkit-app-region: no-drag; padding: 4px 12px; }
  #stage { flex: 1; position: relative; }
  #face { position: absolute; left: 50%; top: 50%; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%;
          image-rendering: pixelated; opacity: 0; transition: opacity .8s ease; pointer-events: none; }
  #face.on { opacity: .85; }
  #said { position: relative; z-index: 2; margin: 0 18px 10px; max-height: 120px; overflow-y: auto; font-size: 14px; line-height: 1.45; padding: 12px 18px; border-radius: 24px; display: none; }
  #said.on { display: block; }
  #status { position: relative; z-index: 2; text-align: center; font-size: 12px; padding: 0 22px 8px; min-height: 16px; }
  #row { position: relative; z-index: 2; display: flex; gap: 8px; align-items: center; margin: 0 18px 18px; padding: 8px; border-radius: 999px; }
  #row input { flex: 1; min-width: 0; background: transparent; border: none; outline: none; color: inherit; font: inherit; padding: 8px 12px; }
  #row .nc-btn { padding: 8px 12px; font-size: 13px; }
  #mic.live { background: rgba(255,154,132,.28); border-color: rgba(255,154,132,.8); }
</style>
</head>
<body class="nc-soft">
<div id="bar"><span>Corona</span><button class="nc-btn" id="close" title="Hide">Hide</button></div>
<div id="stage"><canvas id="face" width="${FACE_SIZE}" height="${FACE_SIZE}"></canvas></div>
<div id="said" class="nc-glass"></div>
<div id="status" class="nc-dim">Press the mic and talk, or type.</div>
<div id="row" class="nc-glass">
  <button class="nc-btn" id="mic">Mic</button>
  <input id="text" class="nc-input" placeholder="Type..." autocomplete="off">
  <button class="nc-btn primary" id="send">Send</button>
  <button class="nc-btn" id="faces" title="Draw pictures the mesh makes on its face doorway">Faces</button>
</div>
<script>
(function () {
  var VOICE_RATE = ${VOICE_RATE}, VOICE_MAX = ${VOICE_MAX_BYTES}, VOICE_MAX_BYTES = VOICE_MAX, FACE = ${FACE_SIZE};
  ${pcmToBytes.toString()}
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('status'), saidEl = $('said'), micBtn = $('mic'), textEl = $('text');
  var history = [];

  function say(msg) { statusEl.textContent = msg; }
  function excite(a) { if (window.ncAmbient) window.ncAmbient.excite(a); }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(t) { var s = atob(t), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

  /* ---- Talking back: the computer's own voice reads what the mesh wrote ---- */
  function speak(text) {
    saidEl.textContent = text; saidEl.classList.add('on');
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.onboundary = function () { excite(0.35); };
    u.onstart = function () { say('Speaking...'); };
    u.onend = function () { say('Listening is off. Press the mic or type.'); };
    speechSynthesis.speak(u);
  }

  function ask(text) {
    text = String(text || '').trim();
    if (!text) return;
    textEl.value = '';
    excite(1);
    say('Thinking...');
    post('/api/chat', { message: text, history: history.slice(-8) }).then(function (r) {
      if (r.error) { say(r.error); return; }
      history.push({ role: 'user', content: text }, { role: 'assistant', content: r.response });
      speak(r.response || '');
    }).catch(function (e) { say('Could not reach the AI: ' + e); });
  }
  $('send').onclick = function () { ask(textEl.value); };
  textEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(textEl.value); });
  $('close').onclick = function () { if (window.electronAPI && window.electronAPI.hideAvatar) window.electronAPI.hideAvatar(); else window.close(); };

  /* ---- Hearing you: raw sound bytes into the "voice" doorway, nothing transcribed ---- */
  var ctx = null, stream = null, node = null, listening = false;
  var capturing = false, chunks = [], quietSince = 0, startedAt = 0;
  var OPEN = 0.04, CLOSE = 0.02, HANG_MS = 700, MAX_MS = 8000;

  function finish() {
    capturing = false;
    var n = 0, i; for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var all = new Float32Array(n), at = 0;
    for (i = 0; i < chunks.length; i++) { all.set(chunks[i], at); at += chunks[i].length; }
    chunks = [];
    if (n < ctx.sampleRate * 0.25) return;           // a click or a cough, not speech
    var bytes = pcmToBytes(all, ctx.sampleRate, VOICE_RATE, VOICE_MAX);
    say('Sending the first ' + Math.round(bytes.length / VOICE_RATE * 1000) + ' ms of what you said (' + bytes.length + ' bytes)...');
    post('/api/doorways/send', { name: 'voice', data: b64(bytes) }).then(function (r) {
      if (r.error) { say(r.error); return; }
      return post('/api/doorways/receive', { name: 'voice', bytes: 4096 }).then(function (o) {
        if (o.error) { say(o.error); return; }
        if (o.bytes > 0) playMesh(unb64(o.data)); else say('Sent. The mesh had no sound to answer with yet.');
      });
    }).catch(function (e) { say('Could not reach the AI: ' + e); });
  }

  function playMesh(bytes) {
    var pcm = new Float32Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) pcm[i] = bytes[i] / 127.5 - 1;
    var buf = ctx.createBuffer(1, pcm.length, VOICE_RATE);
    buf.copyToChannel(pcm, 0);
    var src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    var pulse = setInterval(function () { excite(0.3); }, 120);
    src.onended = function () { clearInterval(pulse); say('Listening.'); };
    say('The mesh is making sound (' + bytes.length + ' bytes)...');
    src.start();
  }

  function onAudio(e) {
    var data = e.inputBuffer.getChannelData(0), sum = 0, i;
    for (i = 0; i < data.length; i++) sum += data[i] * data[i];
    var level = Math.sqrt(sum / data.length), now = performance.now();
    if (listening) excite(Math.min(0.2, level * 2));
    if (!capturing) {
      if (level > OPEN) {
        capturing = true; startedAt = now; quietSince = 0; chunks = [];
        if ('speechSynthesis' in window) speechSynthesis.cancel();   // you spoke over it: it stops
        say('Hearing you...');
      }
    }
    if (capturing) {
      chunks.push(new Float32Array(data));
      if (level < CLOSE) { if (!quietSince) quietSince = now; } else quietSince = 0;
      if ((quietSince && now - quietSince > HANG_MS) || now - startedAt > MAX_MS) finish();
    }
  }

  function stopListening() {
    listening = false; micBtn.classList.remove('live');
    if (node) { node.disconnect(); node.onaudioprocess = null; node = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    say('Listening is off. Press the mic or type.');
  }

  micBtn.onclick = function () {
    if (listening) { stopListening(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say('This window cannot reach a microphone.'); return; }
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } }).then(function (s) {
      stream = s;
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      var src = ctx.createMediaStreamSource(s);
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = onAudio;
      src.connect(node); node.connect(ctx.destination);
      listening = true; micBtn.classList.add('live');
      say('Listening. Just talk.');
    }).catch(function () { say('The microphone was not allowed.'); });
  };

  /* ---- Pictures the mesh makes: raw 32x32 RGBA on the sphere ---- */
  var faceOn = false, faceBuf = new Uint8Array(0), faceCanvas = $('face'), faceCtx = faceCanvas.getContext('2d');
  $('faces').onclick = function () { faceOn = !faceOn; this.classList.toggle('primary', faceOn); if (!faceOn) faceCanvas.classList.remove('on'); };
  setInterval(function () {
    if (!faceOn || document.hidden) return;
    post('/api/doorways/receive', { name: 'face', bytes: FACE * FACE * 4 - faceBuf.length }).then(function (o) {
      if (o.error || !o.bytes) return;
      var got = unb64(o.data), merged = new Uint8Array(faceBuf.length + got.length);
      merged.set(faceBuf, 0); merged.set(got, faceBuf.length); faceBuf = merged;
      if (faceBuf.length >= FACE * FACE * 4) {
        faceCtx.putImageData(new ImageData(new Uint8ClampedArray(faceBuf.subarray(0, FACE * FACE * 4)), FACE, FACE), 0, 0);
        faceBuf = new Uint8Array(0); faceCanvas.classList.add('on');
      }
    }).catch(function () {});
  }, 10000);
})();
</script>
</body>
</html>
`;
