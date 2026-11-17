"use strict;"

let bigInt = require('big-integer');

let partition_table = {
    "0": {
        "company_prefix": {"bits": "40" , "digits": "12"},
        "item_reference": {"bits": "4", "digits": "1"}
    },
    "1": {
        "company_prefix": {"bits": "37" , "digits": "11"},
        "item_reference": {"bits": "7", "digits": "2"}
    },
    "2": {
        "company_prefix": {"bits": "34" , "digits": "10"},
        "item_reference": {"bits": "10", "digits": "3"}
    },
    "3": {
        "company_prefix": {"bits": "30" , "digits": "9"},
        "item_reference": {"bits": "14", "digits": "4"}
    },
    "4": {
        "company_prefix": {"bits": "27" , "digits": "8"},
        "item_reference": {"bits": "17", "digits": "5"}
    },
    "5": {
        "company_prefix": {"bits": "24" , "digits": "7"},
        "item_reference": {"bits": "20", "digits": "6"}
    },

    "6": {
        "company_prefix": {"bits": "20" , "digits": "8"},
        "item_reference": {"bits": "24", "digits": "7"}
    }
};

let len_to_partition_mapping = {
    12: "0",
    11: "1",
    10: "2",
     9: "3",
     8: "4",
     7: "5"
};

let filter = {
    "000": "All Others",
    "001": "Retail Consumer Trade Item",
    "010": "Standard Trade Item Grouping",
    "011": "Single Shipping/ Consumer Trade Item",
    "100": "Reserved",
    "101": "Reserved",
    "110": "Reserved",
    "111": "Reserved",
}

let sgtin = {};

sgtin.generate96BitsEPC = async function(company_prefix, item_reference, serial_number, filter) {
    let header = 30;
    let cp_len = company_prefix.length;
    let pt_lookup = len_to_partition_mapping[cp_len];
    if(!pt_lookup) {

        throw new Error(`Invalid GS1 Company Prefix. Lengths can only be ${Object.keys(len_to_partition_mapping).join(',')}`);
    }
    let pt_row = partition_table[pt_lookup];

    let itemRef_len = item_reference.length;
    if(itemRef_len != pt_row.item_reference.digits) {
        item_reference = helper.pad(item_reference, pt_row.item_reference.digits);
    }

    let bin_header = helper.pad(bigInt(header, 16).toString(2), 8);
    let bin_filter = helper.pad(bigInt(filter, 10).toString(2), 3);
    let bin_partition = helper.pad(bigInt(pt_lookup, 10).toString(2), 8);
    let bin_cp = helper.pad(bigInt(company_prefix, 10).toString(2), pt_row.company_prefix.bits);
    let bin_item_ref = helper.pad(bigInt(item_reference, 10).toString(2), pt_row.item_reference.bits);
    let bin_sr_no = helper.pad(bigInt(serial_number, 10).toString(2), 38);

    let resulting_number = bin_header + bin_filter + bin_partition + bin_cp + bin_item_ref + bin_sr_no;
    console.info(`Resulting number is ${resulting_number.length} bits`);
    let epc = bigInt(resulting_number, 2).toString(16);
    return epc;


}

sgtin.parse96BitEPC = async function(epc) {

    let bin_epc = helper.pad(bigInt(epc, 16).toString(2), 96); // should be 96 bits in length
    let bin_index_pos = 0;
    const bin_header_len = 8;
    const bin_filter_len = 3;
    const bin_partition_len = 3;
    let data = {  };
    // console.info(bin_epc);

    if(bin_epc.length != 96) {
        throw new Error(`EPC error. Length must be 96 bits. Actual length: ${bin_epc.length}`);
    }


    let bin_header = bin_epc.substr(bin_index_pos, bin_header_len);
    if(bin_header != "00110000") {
        throw new Error("EPC header mismatch.");
    }
    bin_index_pos += bin_header_len; // index position updated after stripping header info 8

    let bin_filter = bin_epc.substr(bin_index_pos, bin_filter_len); // we might need it someday, so parse it out and keep it handy
    bin_index_pos += bin_filter_len; // index position updated after stripping filter info - 8 + 3 = 11

    let bin_partition = bin_epc.substr(bin_index_pos, bin_partition_len); // This we need
    let dec_partition = bigInt(bin_partition, 2).toString(10)
    if(!(dec_partition in partition_table)) {
        throw new Error(`Encoding Error: ${bin_partition} invalid`);
    }
    bin_index_pos += bin_partition_len; // index position updated after stripping partition info -  11 + 3 = 14
    const partition_row = partition_table[dec_partition];
    // console.info(partition_row);
    // Time to strip the GS1 CP, Item Reference and Serial Number (TID)
    const bin_cp_len = parseInt(partition_row.company_prefix.bits);
    const bin_item_ref_len = parseInt(partition_row.item_reference.bits);
    const bin_serial_num_len = 38; // This is always 38, and also bin_cp_len + bin_item_ref == 44 always

    const bin_cp =  bin_epc.substr(bin_index_pos, bin_cp_len);
    const dec_cp =  bigInt(bin_cp, 2).toString(10);
    bin_index_pos += bin_cp_len; // length updated after stripping company prefix 14 + 24 = 38 (partition #5)

    const bin_item_ref = bin_epc.substr(bin_index_pos, bin_item_ref_len);
    const dec_item_ref = bigInt(bin_item_ref, 2).toString(10);
    bin_index_pos += bin_item_ref_len; // length updated after stripping item_reference info 38 + 20 = 58 (partition #5)
    // console.info(`Company Prefix: ${dec_cp}, Item Reference: ${dec_item_ref}`);
    const bin_serial_num = bin_epc.substr(bin_index_pos, bin_serial_num_len);
    const dec_serial_num = bigInt(bin_serial_num, 2).toString(10);

    let ean_13 = dec_cp + dec_item_ref;
    let checkbit = "";
    let mul_by_3 = 0;
    let mul_by_1 = 0;
    for(let i = 1; i <= ean_13.length; i++) {
        if(i%2 == 0) {
            mul_by_3 += parseInt(ean_13[i-1]);
        } else {
            mul_by_1 += parseInt(ean_13[i-1]);
        }
    }

    checkbit = 10 + ((-3 * (mul_by_3) - (mul_by_1)) % 10);

    data.gs1Prefix = dec_cp;
    data.itemRef = dec_item_ref;
    data.barcode = ean_13 + checkbit;
    data.serialNumber = dec_serial_num;
    return data;

}

module.exports = sgtin;
