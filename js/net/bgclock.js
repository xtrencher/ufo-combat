// A clock that keeps ticking in a background tab.
//
// Browsers stop requestAnimationFrame in a hidden tab and throttle its
// timers (to once a second, or once a minute after a while). An online game
// must not stop there: the host simulates the world for everyone, and every
// player keeps sending its heartbeat. A dedicated worker's timer is not
// throttled like that, so it posts a tick 20 times a second; the main thread
// runs a simulation step (without drawing) whenever the page is hidden.
export class BackgroundClock {
  constructor(onTick, hz = 20) {
    this.onTick = onTick;
    this.hz = hz;
    this.worker = null;
    this.timer = null;
    this.ticks = 0; // steps run while hidden (tests)
  }

  start() {
    if (this.worker || this.timer) return;
    try {
      const src = `let id=null;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this._tick();
      this.worker.postMessage(Math.round(1000 / this.hz));
    } catch {
      // (No workers: a plain timer, throttled but better than nothing.)
      this.worker = null;
      this.timer = setInterval(() => this._tick(), Math.round(1000 / this.hz));
    }
  }

  stop() {
    if (this.worker) {
      this.worker.postMessage(0);
      this.worker.terminate();
      this.worker = null;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  _tick() {
    if (document.visibilityState !== "hidden") return;
    this.ticks++;
    this.onTick();
  }
}
