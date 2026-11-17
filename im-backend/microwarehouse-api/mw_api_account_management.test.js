const api = require("./mw_api_account_management.js");
const req = require("../tests/lambdas/lib/mockRequest").mockRequest();
const res = require("../tests/lambdas/lib/mockResponse").mockResponse();
describe("Account management", () => {
  it("should get correct users", async () => {
    let request = {
      ...req,
      ...global_req,
    };
    await api.get_users(request, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ data: [] });
  });
});
