"use strict;"


let bigInt = require('big-integer');

let helper = require("./library/helper");
global.helper = helper;

let sgln96 = require("./app/sgln");
let sgtin96 = require("./app/sgtin");


let sgln195 = require("./app/sgln-195");
let sgtin198 = require("./app/sgtin-198");



module.exports = {
    sgln96: sgln96,
    sgtin96: sgtin96
};


