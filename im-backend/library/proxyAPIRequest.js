const { axios, http, https } = require("./xray");
const logger = require("./logger")("library:proxyAPIRequest");

class ProxyAPIRequester {
    constructor () {}

    static KMART_VPCE = config.kmart_vpce;
    static ENDPOINT_TYPE = Object.freeze({
        "TORY": config.tory_api,
        "STORE": config.store_api,
        "INTEGRATION": config.integration_service
    });
    static HTTP_METHOD = Object.freeze({
        "GET": "GET",
        "POST": "POST",
        "PUT": "PUT",
        "DELETE": "DELETE"
    });
    static TIMEOUT_1000_MSEC = 1000;
    static TIMEOUT_1_SEC = 1 * this.TIMEOUT_1000_MSEC;

    static getDefaultAxiosConfig () {
        let agentHttp = new http.Agent({
            keepAlive: true
        });
        let agentHttps = new https.Agent({
            keepAlive: true,
            rejectUnauthorized: false
        });
        let axiosOptions = {
            method: "get",
            baseURL: this.KMART_VPCE,
            httpAgent:  agentHttp,
            httpsAgent: agentHttps,
            timeout: 60 * this.TIMEOUT_1_SEC
        };
        return axiosOptions;
    }

    /* *******************************************************************************
     *  This function takes four parameters
     *  @param method  the HTTP method types (get,post,put,delete)
     *  @param endpointType the type of endpointType (TORY, STORE, INTEGRATION)
     *  @param apiURL  the the Kmart interal API url which you are trying to get data from
     *  @param options  anything that you would pass to the Axios object
     *
     *  call getDefaultAxiosConfig() to see the default options being sent to Axios
     *  This function is called by the static function get(), post(), put(), delete()
     *
     * ******************************************************************************/
    static async CallAPI(method, endpointType, apiURL, options) {
        console.debug("method: " + method + " url: " + apiURL + " endpointType: " + endpointType + " options: " + options);
        let responseObject = {
            status: "Unknown",
            data: {},
            message: ""
        };

        if (!(method in this.HTTP_METHOD)) {
            responseObject.status = 500;
            responseObject.message = "method can only be GET, POST, PUT, DELETE";
            throw responseObject;
        }

        apiURL = apiURL.trim();
        if (apiURL.length == 0 || apiURL.indexOf("http") == 0) {
            responseObject.status = 500;
            responseObject.message = "apiURL cannot be empty or contain http/https prefix";
            throw responseObject;
        }

        if (!(Object.values(this.ENDPOINT_TYPE).includes(endpointType))) {
            responseObject.status = 500;
            responseObject.message = "Must be a valid endpointType";
            throw responseObject;
        }

        let finalURI = this.KMART_VPCE + endpointType + apiURL;
        console.debug("Final URI: " + finalURI);

        let axiosOptions = this.getDefaultAxiosConfig();

        try {
            for (const option of Object.keys(options)) {
                axiosOptions[option] = options[option];
            }
            let response;
            switch (method) {
            case this.HTTP_METHOD.GET:
                response = await axios.get(finalURI, axiosOptions);
                break;
            case this.HTTP_METHOD.POST:
                response = await axios.post(finalURI, axiosOptions);
                break;
            case this.HTTP_METHOD.PUT:
                response = await axios.put(finalURI, axiosOptions);
                break;
            case this.HTTP_METHOD.DELETE:
                response = await axios.delete(finalURI, axiosOptions);
                break;
            default:
                break;
            }

            responseObject.status = 200;
            responseObject.data = response.data;
            return responseObject;
        } catch (error) {
            console.log(error.name + " : " + error.message);
            if (error.response) {
                responseObject.status = error.response.status;
            }
            if (error.response && error.response.data.message) {
                responseObject.message = error.response.data.message;
            }

            throw responseObject;
        }
    }

    static async get(endpointType, apiURL, options) {
        return await this.CallAPI(this.HTTP_METHOD.GET, endpointType, apiURL, options);
    }
    static async post(endpointType, apiURL, options) {
        return await this.CallAPI(this.HTTP_METHOD.POST, endpointType, apiURL, options);
    }
    static async put(endpointType, apiURL, options) {
        return await this.CallAPI(this.HTTP_METHOD.PUT, endpointType, apiURL, options);
    }
    static async delete(endpointType, apiURL, options) {
        return await this.CallAPI(this.HTTP_METHOD.DELETE, endpointType, apiURL, options);
    }
}

module.exports = ProxyAPIRequester;
