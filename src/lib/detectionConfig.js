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
