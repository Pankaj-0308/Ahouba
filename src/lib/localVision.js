/**

 * No API key: smart synthesis of COCO obstacles + OSRM route (see smartGuidance.js).

 */



/**

 * @param {HTMLVideoElement | null} video

 * @returns {Promise<string>}

 */

export async function analyzeSceneLocal({

  video,

  destination,

  routeStep,

  gpsAccuracy,

  heading,

  navContext = null,

}) {

  const { detectNavigationObstacles } = await import("./blindDetection.js");

  const { buildSmartGuidanceFromDetections } = await import("./smartGuidance.js");



  let obstacles = [];

  if (video) {

    try {

      obstacles = await detectNavigationObstacles(video);

    } catch {

      obstacles = [];

    }

  }



  return buildSmartGuidanceFromDetections({

    destination: destination || "your destination",

    routeStep:

      routeStep && String(routeStep).trim().length > 0

        ? String(routeStep).trim()

        : "Follow the blue route on the map.",

    obstacles,

    navContext,

    gpsAccuracyM: gpsAccuracy != null && !Number.isNaN(Number(gpsAccuracy)) ? Number(gpsAccuracy) : null,

    heading: heading != null && !Number.isNaN(Number(heading)) ? Number(heading) : null,

  });

}


