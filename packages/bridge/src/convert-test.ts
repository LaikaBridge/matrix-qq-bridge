import * as fs from "node:fs";
import { convertToMX } from "./image-convert";
(async ()=>{
const buffer = fs.readFileSync("/home/gjz010/图片/explode.gif");
console.log(buffer);
const image = await convertToMX(buffer);
console.log("OK");
console.log(image);
})();