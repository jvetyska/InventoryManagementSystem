let rfid = require("../");
let sgtin = rfid.sgtin96;

async function main() {
    let epc = "30363A22C8346DC37E11D6B8";
    try {
        let ean_13 = await sgtin.parse96BitEPC(epc);
        console.log(ean_13);
    } catch (ex) {
        console.error(ex);
    }

}

main();

