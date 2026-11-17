const http = require("http");

describe("TestRoute API Gateway", function () {
  it("RECV 403 on GET /test-route", () => {
    return http.get("http://localhost:3002/test-route", (result) => {
      expect(result.statusCode).toBe(403);
    });
  });

  it("RECV 200 on POST /test-route", () => {
    return http.request(
      {
        hostname: "http://localhost:3002",
        port: 80,
        path: "/test-route",
        method: "POST",
      },
      (result) => {
        expect(result.statusCode).toBe(200);
      }
    );
  });
});
