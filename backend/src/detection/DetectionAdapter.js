/**
 * Detection adapter interface.
 *
 * A detection adapter observes "device seen on an authorised network" events
 * and funnels them into the WorkPulse feed as normalised detections.
 *
 * The presence engine never cares where an event came from — only that a
 * registered device connected or disconnected from an authorised network.
 *
 * Why raw MACs are not assumed: modern phones randomise their MAC addresses,
 * so real deployments use a companion app, a certificate/RADIUS identity or a
 * controller integration (see DeviceIdentityStrategy in the Prisma schema).
 * Adapters therefore always supply a stable `rawDeviceId`, never a raw MAC.
 */

/**
 * @typedef {Object} Detection
 * @property {string} rawDeviceId  stable identity as reported by the adapter
 * @property {string} networkName  authorised network the device attached to
 * @property {'CONNECT'|'DISCONNECT'} eventType
 * @property {Date|number} timestamp when the event happened
 * @property {object} [context]     adapter-specific context (location, AP, RSSI…)
 */

export class DetectionAdapter {
  /**
   * Subscribes to detections coming from a live feed.
   * @param {(detection: Detection) => void} callback
   */
  onDetection(callback) {
    throw new Error('Adapter must implement onDetection(callback)');
  }

  /**
   * Push a single detection through the adapter (tests, simulators, CLI).
   * @param {Detection} detection
   */
  async emit(detection) {
    throw new Error('Adapter must implement emit(detection)');
  }

  /** Start consuming the backing feed. */
  async start() {
    throw new Error('Adapter must implement start()');
  }

  /** Stop consuming the backing feed. */
  async stop() {
    throw new Error('Adapter must implement stop()');
  }
}