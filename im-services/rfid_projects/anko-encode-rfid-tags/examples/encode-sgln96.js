
let rfid = require("../");
let sgln96 = rfid.sgln96;



async function main() {

    let gs1_prefix = "9341106";
    let location_reference = "98100";
    let extension = "12345";

    let epc = await sgln96.generate96BitsEPC(gs1_prefix, location_reference, extension);
    console.log(epc);

}

function demo() {
    main();
}

demo();



