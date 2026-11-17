
"use strict;"

let bigInt = require('big-integer');

let sgln = {};

let partition_table = {
    "0": {
        "company_prefix": {"bits": "40" , "digits": "12"},
        "location_reference": {"bits": "1", "digits": "0"}
    },
    "1": {
        "company_prefix": {"bits": "37" , "digits": "11"},
        "location_reference": {"bits": "4", "digits": "1"}
    },
    "2": {
        "company_prefix": {"bits": "34" , "digits": "10"},
        "location_reference": {"bits": "7", "digits": "2"}
    },
    "3": {
        "company_prefix": {"bits": "30" , "digits": "9"},
        "location_reference": {"bits": "11", "digits": "3"}
    },
    "4": {
    "company_prefix": {"bits": "27" , "digits": "8"},
    "location_reference": {"bits": "11", "digits": "4"}
    },
    "5": {
        "company_prefix": {"bits": "24" , "digits": "7"},
        "location_reference": {"bits": "17", "digits": "5"}
    },
    "6": {
        "company_prefix": {"bits": "20" , "digits": "6"},
        "location_reference": {"bits": "21", "digits": "6"}
    }
};

let gs1_prefix_partition_map = {
    12: "0",
    11: "1",
    10: "2",
    9:  "3",
    8:  "4",
    7:  "5",
    6:  "6"
};

let filter_table = {
    "000": "All Others",
    "001": "Physical Location",
    "010": "Reserved",
    "011": "Reserved",
    "100": "Reserved",
    "101": "Reserved",
    "010": "Reserved",
}

sgln.generate96BitsEPC = async function(gs1_prefix, location_reference, extension) {

    let gln_header = helper.pad(bigInt("32", 16).toString(2), 8);
    let filter_value = "000";
    let gs1_length = gs1_prefix.length;

    let proposed_partition_values = gs1_prefix_partition_map[gs1_length];

    if(!proposed_partition_values) {
        throw new Error("Invalid GS1 Prefix Length");
    }

    let partition_values_to_use = partition_table[proposed_partition_values];

    if(location_reference.length != partition_values_to_use.location_reference.digits) {
        throw new Error(`Invalid Location Reference. Must be ${partition_values_to_use.location_reference.digits} in length`);
    }

    let proposed_partition_values_binary = helper.pad(bigInt(proposed_partition_values,10).toString(2), 3);
    let gs1_cp_binary = helper.pad(bigInt(gs1_prefix, 10).toString(2), partition_values_to_use.company_prefix.bits);
    let loc_ref_binary = helper.pad(bigInt(location_reference, 10).toString(2), partition_values_to_use.location_reference.bits);
    let ext_b = helper.pad(bigInt(extension,10).toString(2), 96-55);

    // console.info("header: ", gln_header, " ", gln_header.length, " bits");
    // console.info("filter_value", filter_value, " ", filter_value.length, " bits" );
    // console.info("partition: ", proposed_partition_values_binary, " ", proposed_partition_values_binary.length, " bits");
    // console.info("gs1: ", gs1_cp_binary, " ", gs1_cp_binary.length, " bits");
    // console.info("location_reference: ", loc_ref_binary, " ", loc_ref_binary.length, " bits");
    // console.info("extension: ", ext_b, " ", ext_b.length, " bits");

    let resulting_number = gln_header + filter_value + proposed_partition_values_binary + gs1_cp_binary + loc_ref_binary + ext_b;

    // console.info("Resulting Number is ", resulting_number.length, " bits");
    let epc96 = bigInt(resulting_number, 2).toString(16);
    return epc96;
}

sgln.parse96BitsEPC = async function(epc) {

};



module.exports = sgln;
