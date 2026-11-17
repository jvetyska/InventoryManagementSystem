"use strict;"

let helperFn = {};

helperFn.pad =  function (num, size) {
    var s = "000000000000000000000000000000000000000000000000000000000000000000000" + num;
    return s.substr(s.length-size);
};

module.exports = helperFn;
