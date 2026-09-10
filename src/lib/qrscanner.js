import jsQR from 'jsqr';

/**
 * Drives a <video> element from the device camera and repeatedly runs jsQR
 * against its frames. This is the one Phase 3 module that genuinely cannot
 * be verified without a real camera and something physical to scan (see the
 * README) - qrtransport.js's own round-trip test already proves the format
 * this feeds into (BBQr split/join) and the decoder (jsQR) work correctly
 * together against real rendered QR images; this class is just the camera
 * plumbing on top of that.
 */
export class QrScanner {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
    this.rafId = null;
    this.requestId = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Requests camera access and starts scanning. `onDecode(text)` fires once per distinct decoded frame. */
  async start(onDecode) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no soporta acceso a la camara (getUserMedia no disponible).');
    }
    // getUserMedia can sit pending on the OS/browser permission prompt for a
    // long time. If stop() (Cancelar) runs while it's still pending, this
    // request must discard whatever stream shows up later instead of
    // resurrecting a scan session the user already dismissed.
    const requestId = ++this.requestId;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    if (requestId !== this.requestId) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.stream = stream;
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();

    let lastDecoded = null;
    const tick = () => {
      if (!this.stream) return; // stopped
      if (this.videoEl.readyState === this.videoEl.HAVE_ENOUGH_DATA) {
        const w = this.videoEl.videoWidth;
        const h = this.videoEl.videoHeight;
        if (w && h) {
          this.canvas.width = w;
          this.canvas.height = h;
          this.ctx.drawImage(this.videoEl, 0, 0, w, h);
          const frame = this.ctx.getImageData(0, 0, w, h);
          const result = jsQR(frame.data, w, h);
          // A physical BBQr sequence keeps showing the same frame for a
          // little while - only fire on genuinely new content, not every
          // repaint of the same code.
          if (result && result.data !== lastDecoded) {
            lastDecoded = result.data;
            onDecode(result.data);
          }
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.requestId++; // invalidate any start() still awaiting the permission prompt
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}
