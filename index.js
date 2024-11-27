const fs = require("fs");
const csv = require("csv-parser");
const converter = require("json-2-csv");

// Helper functions
const parseGPS = (gpsString) => {
  if (!gpsString) return [0, 0];
  const [lat, lon] = gpsString.split(' ').map(parseFloat);
  return [lat || 0, lon || 0];
};

const calculateDistance = (lat1, lon1, alt1, lat2, lon2, alt2) => {
  // Return 0 if any coordinate is invalid
  if (!isFinite(lat1) || !isFinite(lon1) || !isFinite(lat2) || !isFinite(lon2)) {
    return 0;
  }

  // WGS84 ellipsoid parameters
  const a = 6378137.0; // semi-major axis in meters
  const f = 1/298.257223563; // flattening
  const b = a * (1 - f); // semi-minor axis
  
  // Convert to radians
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const lambda1 = lon1 * Math.PI / 180;
  const lambda2 = lon2 * Math.PI / 180;
  
  // Calculate reduced latitudes
  const U1 = Math.atan((1 - f) * Math.tan(phi1));
  const U2 = Math.atan((1 - f) * Math.tan(phi2));
  const L = lambda2 - lambda1;
  
  let lambda = L;
  let iterLimit = 100;
  let sigma, sinSigma, cosSigma, cos2SigmaM, sinLambda, cosLambda, cos2Alpha;
  
  do {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    
    sinSigma = Math.sqrt(
      Math.pow(Math.cos(U2) * sinLambda, 2) +
      Math.pow(Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cosLambda, 2)
    );
    
    if (sinSigma === 0) return 0;
    
    cosSigma = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    
    const sinAlpha = Math.cos(U1) * Math.cos(U2) * sinLambda / sinSigma;
    cos2Alpha = 1 - Math.pow(sinAlpha, 2);
    
    cos2SigmaM = cosSigma - 2 * Math.sin(U1) * Math.sin(U2) / cos2Alpha;
    if (isNaN(cos2SigmaM)) cos2SigmaM = 0;
    
    const C = f / 16 * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    
    const lambdaNew = L + (1 - C) * f * sinAlpha * (
      sigma + C * sinSigma * (
        cos2SigmaM + C * cosSigma * (-1 + 2 * Math.pow(cos2SigmaM, 2))
      )
    );
    
    if (Math.abs(lambdaNew - lambda) < 1e-12) break;
    lambda = lambdaNew;
  } while (--iterLimit > 0);
  
  if (iterLimit === 0) return 0;
  
  const uSq = cos2Alpha * (Math.pow(a, 2) - Math.pow(b, 2)) / Math.pow(b, 2);
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  
  const deltaSigma = B * sinSigma * (
    cos2SigmaM + B / 4 * (
      cosSigma * (-1 + 2 * Math.pow(cos2SigmaM, 2)) -
      B / 6 * cos2SigmaM * (-3 + 4 * Math.pow(sinSigma, 2)) *
      (-3 + 4 * Math.pow(cos2SigmaM, 2))
    )
  );
  
  // Calculate 2D distance
  const distance2D = b * A * (sigma - deltaSigma);
  
  // Add altitude component using Pythagorean theorem
  const altDiff = alt2 - alt1;
  const distance3D = Math.sqrt(Math.pow(distance2D, 2) + Math.pow(altDiff, 2));
  
  return distance3D;
};

const getAvarage = (i, srt) => {
  if (!srt[i]) return { bitrate: 0, delay: 0 };
  const prev = i === 0 ? srt[0] : srt[i - 1];
  const curr = srt[i];
  const next = i === srt.length - 1 ? srt[i] : srt[i + 1];
  
  return {
    bitrate: ((prev.bitrate + curr.bitrate + next.bitrate) / 3).toFixed(2),
    delay: ((prev.delay + curr.delay + next.delay) / 3).toFixed(2)
  };
};

const writeToFile = async (data) => {
  try {
    const timestamp = new Date().getTime();
    const filename = `./logs/dashware-tele_${timestamp}.csv`;
    const csv = await converter.json2csv(data);
    fs.writeFileSync(filename, "OpenTX Import\n" + csv);
    console.log(`File written successfully to: ${filename}`);
  } catch (error) {
    console.error('Error writing file:', error);
  }
};

// Process SRT file
const processSrtFile = (srtLines) => {
  const srtData = [];
  
  for (let i = 0; i < srtLines.length; i++) {
    const line = srtLines[i].trim();
    if (line.includes("-->")) {
      const subtitleText = srtLines[i + 1].trim();
      const arr = subtitleText.split(" ");
      
      srtData.push({
        bitrate: Number(arr.find(a => a.includes("bitrate"))?.replace("bitrate:", "").replace("Mbps", "") || 0),
        delay: Number(arr.find(a => a.includes("delay:"))?.replace("delay:", "").replace("ms", "") || 0)
      });
    }
  }
  
  return srtData;
};

// Main process
const srtFilePath = "./logs/DJIG0064.srt";
const csvFilePath = "./logs/rekon-2024-11-26-Session2.csv";
const srtLines = fs.readFileSync(srtFilePath, "utf-8").split("\n");
const srtData = processSrtFile(srtLines);
const telemetryData = [];

fs.createReadStream(csvFilePath)
  .pipe(csv())
  .on("data", (row) => telemetryData.push(row))
  .on("end", () => {
    const matchLengthSrt = telemetryData.map((d, i) => {
      const index = Math.floor((srtData.length / telemetryData.length) * i);
      const { bitrate, delay } = getAvarage(index, srtData);
      
      // Parse coordinates
      const [currentLat, currentLon] = parseGPS(d.GPS);
      const [startLat, startLon] = parseGPS(telemetryData[0].GPS);
      const currentAlt = Number(d["Alt(m)"]) || 0;
      const startAlt = Number(telemetryData[0]["Alt(m)"]) || 0;
      
      // Calculate distance
      const distanceFromStart = calculateDistance(
        startLat, startLon, startAlt,
        currentLat, currentLon, currentAlt
      );

      return {
        "time": d.Time,
        "Latitude": currentLat,
        "Longitude": currentLon,
        "Current Distance": Math.round(distanceFromStart),
        "Elevation": d["Alt(m)"],
        "RQly(%)": d["RQly(%)"],
        "RSNR(dB)": d["RSNR(dB)"],
        "TPWR(mW)": d["TPWR(mW)"],
        "TQly(%)": d["TQly(%)"],
        "TSNR(dB)": d["TSNR(dB)"],
        "GSpd(kmh)": d["GSpd(kmh)"],
        "Hdg(@)": d["Hdg(@)"],
        "Sats": d.Sats,
        "RxBt(V)": d["RxBt(V)"],
        "Curr(A)": d["Curr(A)"],
        "Capa(mAh)": d["Capa(mAh)"],
        "Bat(%)": d["Bat_(%)"],
        "Ptch(rad)": d["Ptch(rad)"],
        "Roll(rad)": d["Roll(rad)"],
        "Yaw(rad)": d["Yaw(rad)"],
        "Thr": d.Thr,
        "bitrate": bitrate,
        "delay": delay
      };
    });

    writeToFile(matchLengthSrt);
  });
