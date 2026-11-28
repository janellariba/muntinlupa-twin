// detectionConfig.js
// Every fixed value used by live detection and triangulation, in one place.
// STATUS: TEMPORARY prototype values, approved 2026-11-27. Each must be replaced by a measured or
// validated value before real use. Sources are the dt-step4-ui config files unless marked "new".

export const DETECTION = {
  // detection.json conf_threshold: boxes below this confidence are ignored. Tune from validation results.
  confThreshold: 0.5,
  // Overlap limit for removing duplicate boxes (non-maximum suppression). 0.7 is the Ultralytics
  // default, which is what your camera node uses (it calls model.predict without changing iou).
  nmsIou: 0.7,
  // New (approved): YOLO runs per second per open camera in the browser. The camera node uses 5;
  // lower keeps a laptop responsive with several cameras. A slow device simply runs less often.
  runsPerSecond: 2,
  // monitoring.json detecting_window_s: detections from the last N seconds are combined.
  combineWindowS: 5,
};

export const TRIANGULATION = {
  // simulation.json min_ray_angle_deg: reject if the widest angle between any two lines is below this.
  minRayAngleDeg: 5,
  // simulation.json max_range_m: reject estimates farther than this from any camera.
  maxRangeM: 8000,
  // simulation.json bearing_noise_deg_default: expected bearing error (1 standard deviation),
  // used for weighting and the 95% ellipse. Replace with the measured calibration error.
  bearingSigmaDeg: 1,
  // simulation.json ray_display_extend: DISPLAY ONLY, bearing lines drawn to 1.3x the estimate distance.
  rayDisplayExtend: 1.3,
};

// New (approved): pixel -> bearing uses a pinhole camera model with no lens-distortion correction:
//   bearing = heading + atan( (x - W/2) / (W/2) * tan(FOV/2) )
// x = box centre in pixels, W = image width, heading = true bearing of the image centre.
// Temporary until the cameras are calibrated.

// Database logging and recording (admin console). TEMPORARY values approved 2026-11-28.
export const LOGGING = {
  // Save 1 snapshot (picture + detection) per camera at most every N seconds while it sees fire/smoke.
  snapshotIntervalS: 10,
  // Save the fire estimate when it first appears, then at most every N seconds while it lasts.
  estimateIntervalS: 10,
  // Manual recordings stop automatically after this many seconds (1 hour). Saved on the admin laptop.
  maxRecordingS: 3600,
  // The twin page asks the database for cameras, snapshots and the estimate every N seconds.
  twinRefreshS: 5,
};
// Derived, not a new value: the twin shows an estimate as ACTIVE while it is newer than
// 2 x estimateIntervalS (it is re-saved every estimateIntervalS while the fire is tracked).
export const ACTIVE_ESTIMATE_S = 2 * LOGGING.estimateIntervalS;

// Live video (Cloudflare Realtime) and previews. previewIntervalS approved 2026-11-28 ("snapshot per min").
// TEMPORARY values awaiting approval: heartbeatS, offlineAfterS, maxBitrateKbps.
export const LIVE = {
  previewIntervalS: 60,  // public viewers (no password) see a picture of each camera updated every 60 s
  heartbeatS: 15,        // the admin laptop tells the server "still streaming" every 15 s
  offlineAfterS: 45,     // no heartbeat for 45 s (3 missed) = camera shown as offline
  maxBitrateKbps: 1500,  // cap per camera stream: ~0.7 GB per viewer-hour, keeps the laptop upload manageable
};
