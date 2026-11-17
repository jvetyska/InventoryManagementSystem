//********** ACCOUNT CONFIGURATION **********



// anything global for all the account goes inside config
// also don't repeat properties in config and the account specific config files
// the right most object (when spreading properties) will overwrite the stuff in the left most object
// i.e. - in this case accountConfig will overwrite any property mentioned in globalConfig
let productionEnv = ["anko", "kmart-uat", "kmart-prod", "kmart-hamilton-uat", "kmart-hamilton-prod"];
let kmartEnvironment = ["kmart-dev", "kmart-uat", "kmart-prod"];
let hamiltonEnvironment = [ "kmart-hamilton-dev", "kmart-hamilton-svt", "kmart-hamilton-uat", "kmart-hamilton-prod"];
var globalConfig = {
    account: "anko_microwarehouse",
    env_type: process.env.ENV_TYPE || "dev",
    isDevelopment: process.env.ENV_TYPE === undefined || process.env.ENV_TYPE === "dev" ? true : false,
    isProduction: productionEnv.includes(process.env.ENV_TYPE),
    isKmartEnvironment: kmartEnvironment.includes(process.env.ENV_TYPE),
    isHamiltonEnvironment: hamiltonEnvironment.includes(process.env.ENV_TYPE)
    // api_host: "http://localhost:3000",
};
let accountConfig;
/* *****************************************
 *  [env_type] value explanation
 *
 * -> anko : anko production
 * -> anko-dev : anko development
 * -> kmart : kmart production
 * -> kmart-dev : kmart development
 * -> default: anko-dev
 * *******************************************/
if (globalConfig.env_type == "kmart-prod") {
    accountConfig = require("./kmart_prod.js");
} else if (globalConfig.env_type == "anko") {
    accountConfig = require("./anko_prod.js");
} else if(globalConfig.env_type == "kmart-dev"){
    accountConfig = require("./kmart_dev.js");
} else if(globalConfig.env_type == "kmart-uat"){
    accountConfig = require("./kmart_uat.js");
} else if(globalConfig.env_type == "kmart-hamilton-dev"){
    accountConfig = require("./kmart_hamilton_dev.js");
} else if(globalConfig.env_type == "kmart-hamilton-svt"){
    accountConfig = require("./kmart_hamilton_svt.js");
} else if(globalConfig.env_type == "kmart-hamilton-uat"){
    accountConfig = require("./kmart_hamilton_uat.js");
} else if(globalConfig.env_type == "kmart-hamilton-prod"){
    accountConfig = require("./kmart_hamilton_prod.js");
} else if(globalConfig.env_type == "local-dev"){
    accountConfig = require("./local_dev.js");
}  else {
    accountConfig = require("./anko_dev.js");
}

let config = {
    ...globalConfig,
    ...accountConfig
}

module.exports = config;
