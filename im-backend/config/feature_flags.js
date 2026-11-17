/* eslint-disable no-undef */

let config = require("./config");
let env = config.env_type;

const featureFlags = {
    enableNetworkPrinters: false,
};

const featureFlagsOverrides = { 
};

for ( let featureOveride in featureFlagsOverrides[env] ) {
    featureFlags[featureOveride] = featureFlagsOverrides[env][featureOveride];
}

module.exports = featureFlags;
