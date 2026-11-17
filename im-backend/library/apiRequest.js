const { axios } = require("./xray");
const rp = require("request-promise");
const logger = require("./logger")("library:apiRequest");

exports.get = async function (req, api, data) {
    const uri = config.api_host+"/api/"+api;
    try {
        // Forward the original User ID, name, and role
        const headers = _getHeadersToForward(req.headers);

        const res = await axios.get(uri, {"params": data, "headers": headers});
        return res.data;
    } catch (error) {
        let status = "Unknown";
        let message = "An unspecified error occured";

        if (error.response) {
            status = error.response.status;
        }

        if (error.response && error.response.data.message) {
            message = error.response.data.message;
        }

        console.log(`GET ${api} (${status}): ${message}`);
        return Promise.reject({"status": status, "message": message});
    }
};

exports.post = async function (req, api, data) {
    const uri = config.api_host+"/api/"+api;
    try {
        // Forward the original User ID, name, and role
        const headers = _getHeadersToForward(req.headers);
        const res = await axios.post(uri, data, {"headers": headers});

        return res.data;
    } catch (error) {
        let status = "Unknown";
        let message = "An unspecified error occured";

        if (error.response) {
            status = error.response.status;
        }

        if (error.response && error.response.data.message) {
            message = error.response.data.message;
        }

        console.log(`POST ${api} (${status}): ${message}`);
        return Promise.reject({"status": status, "message": message});
    }
};

exports.put = async function (req, api, data) {
    const uri = config.api_host+"/api/"+api;
    try {
        // Forward the original User ID, name, and role
        const headers = _getHeadersToForward(req.headers);

        const res = await axios.put(uri, data, {"headers": headers});
        return res.data;
    } catch (error) {
        let status = "Unknown";
        let message = "An unspecified error occured";

        if (error.response) {
            status = error.response.status;
        }

        if (error.response && error.response.data.message) {
            message = error.response.data.message;
        }

        console.log(`PUT ${api} (${status}): ${message}`);
        return Promise.reject({"status": status, "message": message});
    }
};

exports.delete = async function (req, api, data) {
    const uri = config.api_host+"/api/"+api;
    try {
        // Forward the original User ID, name, and role
        const headers = _getHeadersToForward(req.headers);
        const res = await axios.delete(uri, {"params": data, "headers": headers});
        return res.data;
    } catch (error) {
        let status = "Unknown";
        let message = "An unspecified error occured";

        if (error.response) {
            status = error.response.status;
        }

        if (error.response && error.response.data.message) {
            message = error.response.data.message;
        }

        console.log(`DELETE ${api} (${status}): ${message}`);
        return Promise.reject({"status": status, "message": message});
    }
};

exports.syncGet = async function(req, api, data) {

    let options = {
        method: api.method,
        uri: (api.url + "?" + api.query),
        headers: api.headers,
        json: true
    };

    return new Promise((resolve, reject) => {
        rp(options).then((response) => {
            resolve(response);
        }).catch((err) => {
            reject(err);
        });
    });
};

exports.syncPost = async function(req, api, data) {

    let options = {
        method: "POST",
        uri: api.url,
        headers: api.headers,
        body: api.payload,
        json: true
    };

    return new Promise((resolve, reject) => {
        rp(options).then((response) => {
            resolve(response);
        }).catch((err) => {
            reject(err);
        });

    });
};

function _getHeadersToForward(requestHeaders) {
    let headers = {
        "system-token": config.system_token
    };

    // If there is a user-id header, forward the user headers from the request
    if (requestHeaders["user-id"]) {
        headers["user-id"] = requestHeaders["user-id"];
        headers["user-name"] = requestHeaders["user-name"];
        // There is an axios 0.19.2 bug causing this array to be converted to the string [object Object]
        // Stringify the array and parse it in authHelper.js
        headers["user-role"] = JSON.stringify(requestHeaders["user-role"]);
    }

    return headers;
}
