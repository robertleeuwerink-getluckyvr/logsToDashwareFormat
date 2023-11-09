const fs = require("fs");
const csv = require("csv-parser");
const converter = require("json-2-csv");

// Read the SRT file
const srtFilePath = "./logs/DJIG0096.srt";
const srtData = fs.readFileSync(srtFilePath, "utf-8");
const srtLines = srtData.split("\n");
// Read the CSV file
const csvFilePath = "./logs/rekon-2023-11-07-Session1.csv";
const telemetryData = [];
const telemetryJioned = [];
fs.createReadStream(csvFilePath)
  .pipe(csv())
  .on("data", (row) => {
    telemetryData.push(row);
    // console.log(row)
  })
  .on("end", () => {
    // Process the data
    const joinedData = [];
    const srt = [];
    const extra = 3;

    for (let i = 0; i < srtLines.length; i++) {
      const line = srtLines[i].trim();

      if (line.includes("-->")) {
        const [start, end] = line.split("-->");
        const subtitleText = srtLines[i + 1].trim();
        // console.log(subtitleText)
        const arr = subtitleText.split(" ");

        const bitrate = Number(
          arr
            .find((a) => a.includes("bitrate"))
            ?.replace("bitrate:", "")
            .replace("Mbps", "")
        );
        const delay = Number(
          arr
            .find((a) => a.includes("delay:"))
            ?.replace("delay:", "")
            .replace("ms", "")
        );
        srt.push({
          bitrate,
          delay,
        });
      }
    }
    console.log(srt.length, telemetryData.length);

    // Output the joined data
    const matchLengthSrt = telemetryData.map((d, i) => {
      const index = Math.floor((srt.length / telemetryData.length) * i);
      const { bitrate, delay } = getAvarage(index, srt);
      const data = {
        date: d.Date,
        time: d.Time,
        "RQly(%)": d["RQly(%)"],
        "RSNR(dB)": d["RSNR(dB)"],
        "TPWR(mW)": d["TPWR(mW)"],
        "TQly(%)": d["TQly(%)"],
        "TSNR(dB)": d["TSNR(dB)"],
        GPS: d["GPS"],
        "GSpd(kmh)": d["GSpd(kmh)"],
        "Hdg(@)": d["Hdg(@)"],
        "Alt(m)": d["Alt(m)"],
        Sats: d["Sats"],
        "RxBt(V)": d["RxBt(V)"],
        "Curr(A)": d["Curr(A)"],
        "Capa(mAh)": d["Capa(mAh)"],
        "Bat_(%)": d["Bat_(%)"],
        "Ptch(rad)": d["Ptch(rad)"],
        "Roll(rad)": d["Roll(rad)"],
        "Yaw(rad)": d["Yaw(rad)"],
        Thr: d["Thr"],
        bitrate,
        delay,
      };
      return data;
    });
    console.log(matchLengthSrt);
    const csv = writeToFile(matchLengthSrt);
  });

const getAvarage = (i, srt) => {
  const prev = i === 0 ? srt[0] : srt[i - 1];
  const curr = srt[i];
  const next = i === srt.length ? srt[srt.length + 1] : srt[i];
  const bitrate = ((prev.bitrate + curr.bitrate + next.bitrate) / 3).toFixed(2);
  const delay = ((prev.delay + curr.delay + next.delay) / 3).toFixed(2);

  return {
    bitrate,
    delay,
  };
};

const writeToFile = async (data, fileName) => {
  const csv = await converter.json2csv(data);
  const writeStream = fs.createWriteStream("./logs/dashware-tele.csv");
  writeStream.write(csv);
  writeStream.end();
};
