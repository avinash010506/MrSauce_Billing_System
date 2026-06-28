const https = require("https");
const fs = require("fs");
https.get("https://www.mrsauce.co.uk/public/assets/img/logo.png", (res) => {
  let data = [];
  res.on("data", (chunk) => data.push(chunk));
  res.on("end", () => {
    const b64 = Buffer.concat(data).toString("base64");
    fs.writeFileSync(
      "src/lib/logo.ts",
      'export const logoBase64 = "data:image/png;base64,' + b64 + '";\n',
    );
    console.log("Logo saved");
  });
});
