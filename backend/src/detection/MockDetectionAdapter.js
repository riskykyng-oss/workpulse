import { DetectionAdapter } from './DetectionAdapter.js';

/**
 * Mock detection adapter — ships the whole product with no hardware.
 *
 * It does not generate data on its own (the seed database already contains the
 * canonical day). Instead it provides a control surface used by the demo
 * toolbar so HR can drive the real pipeline: trigger an arrival, a lunch
 * departure, a departure, an unknown-device exception or a network outage.
 * Every control funnels *real* detections through the normal detection →
 * confirmation → arrival → ping path.
 */
export class MockDetectionAdapter extends DetectionAdapter {
  constructor() {
    super();
    this._listener = null;
    this.started = false;
    this.outage = false;
  }

  onDetection(callback) {
    this._listener = callback;
  }

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  /**
   * Push one detection through.
   * @param {import('./DetectionAdapter.js').Detection} detection
   */
  async emit(detection) {
    if (!this.started) await this.start();
    if (this.outage && detection.eventType === 'CONNECT') {
      // During an outage the feed is down: connects are not observed.
      return false;
    }
    if (this._listener) {
      await this._listener(detection);
      return true;
    }
    return false;
  }

  /**
   * Demo control — simulate a device appearing on an authorised network.
   * RNI = "replayed network incident", a plain Detection.
   */
  async simulate(detection) {
    return this.emit(detection);
  }
}

export const mockAdapter = new MockDetectionAdapter();