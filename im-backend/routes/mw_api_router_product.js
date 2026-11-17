var api = require("../microwarehouse-api/mw_api_product.js");
var express = require("express");
var router = express.Router();
var multer = require("multer"); // Handling uploaded files, multipart/form-data
var storage = multer.memoryStorage();
var upload = multer({ storage: storage });
//var upload = multer({"dest": "tmp/"}); // Set the temporary directory where files are uploaded
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/get_product:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *      - product
 *     summary: Get basic product information that is most likely to be used by the front-end
 *     description: |
 *       The information that this API endpoint returns is: APN, Product_Name, Department_Name, IMAGE_PRIMARY, Online_Name, Sell_Price_Usd
 *
 *       You must provide either a Keycode OR ProductID. If both are provided, then the ProductID parameter will be ignored
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: Keycode
 *         description: DEPRICATED - The Keycode of the product that you want the information for
 *         in: query
 *         required: false
 *         type: string
 *       - name: ProductID
 *         description: Any product identifier, such as the barcode, keycode or any case barcode
 *         in: query
 *         required: false
 *         type: string
 *       - name: LocationID
 *         description: Optional Location barcode to get location specific UPT value
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_product", Auth(), api.get_product);

/**
 * @swagger
 * /api/search_product:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Get basic product search results
 *     description: |
 *       The information that this API endpoint returns is: APN, Product_Name, Department_Name, IMAGE_PRIMARY, Online_Name, Sell_Price_Usd
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: product_name
 *         description: The product name(s) the retrieve data for. You may specify multiple products by seperating them with commas
 *         in: query
 *         required: true
 *         type: string
 *       - name: locationId
 *         description: Location barcode to get location specific Product Price value
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/search_product", Auth(), api.search_product);

/**
 * @swagger
 * /api/get_product_blacklist:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Returns current blacklist content
 *     description: |
 *       Returns current blacklist content
 *       As it is stored internally, individual rows for blacklist entry and valid store.
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_product_blacklist", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_product_blacklist);

/**
 * @swagger
 * /api/blacklist_product_update:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Process Raw blacklist and re-create accessible blacklist
 *     description: |
 *       Process Raw blacklist and re-create accessible blacklist
 *       Generates ProductID, LocationID structure
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/blacklist_product_update", Auth(["admin"]), api.blacklist_product_update);


/**
 * @swagger
 * /api/blacklist_product_from_csv:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Ingests a .csv file and populates table blacklisting products or categories
 *     description: |
 *       Ingests a .csv file and populates table blacklisting products or categories
 *       Sample csv header: Retail_Zone_ID, Department Name, Class Name, Keycode, Product Name, BEL1-STR, MIL1-STR, LYN1-STR, ONL1-STR, ...
 *       Each time csv is uploaded, it will wipe out previous entries.
 *       To completely clean the black list, upload a file with one item and a dummy store checked.
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/blacklist_product_from_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), upload.single("csvfile"), api.blacklist_product_from_csv);

/**
 * @swagger
 * /api/blacklist_product_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Produces a .csv file and populates it in the same format that the download expects.
 *     description: |
 *       Produces a .csv file and populates it in the same format that the download expects.
 *       Sample csv header: Retail_Zone_ID, Department Name, Class Name, Keycode, Product Name, BEL1-STR, MIL1-STR, LYN1-STR, ONL1-STR, ...
 *       This should help anyone to make changes easily and avoid having one person managing the master list.
 *     produces:
 *       - text/csv
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/blacklist_product_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.blacklist_product_csv);

/**
 * @swagger
 * /api/mdu_from_csv:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Ingests a .csv file and populates MDU
 *     description: |
 *       Ingests a .csv file and populates MDU
 *       Sample csv header: Keycode, BEL1-STR, MIL1-STR, LYN1-STR, ONL1-STR, ...
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/mdu_from_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), upload.single("csvfile"), api.mdu_from_csv);

/**
 * @swagger
 * /api/product_list_from_csv:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: 'Ingests a .csv file and inserts/updates into the tables: product, product_barcode, and product_attr'
 *     description: |
 *       Ingests a .csv file and inserts/updates into the tables: product, product_barcode, and product_attr
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - name: csvtype
 *         type: string
 *         in: formData
 *         description: The type of the .csv file. Currently the only two options are "with-image-primary" or "without-image-primary"
 *         required: true
 *       - name: csvfile
 *         type: file
 *         in: formData
 *         description: The file to upload
 *         required: true
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/product_list_from_csv", Auth(["admin"]), upload.single("csvfile"), api.product_list_from_csv);

/**
 * @swagger
 * /api/download_mdu_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Produces a .csv file and populates it in the same format that the download expects.
 *     description: |
 *       Produces a .csv file and populates it in the same format that the download expects.
 *       Sample csv header: Keycode, BEL1-STR, MIL1-STR, LYN1-STR, ONL1-STR, ...
 *       This should help anyone to make changes easily and avoid having one person managing the master list.
 *     produces:
 *       - text/csv
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/download_mdu_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.download_mdu_csv);

/**
 * @swagger
 * /api/update_product_mdu:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Update MDU for product and location
 *     description: |
 *       Update MDU (Minimum Display Units) for Product and Location
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Keycode:
 *                 type: number
 *               LocationID:
 *                 type: string
 *               MDU:
 *                 type: number
 *               EXT:
 *                 type: boolean
 *             examples:
 *               Keycode:
 *                 value: 9800113
 *                 summary: Product keycode
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: Location barcode
 *               MDU:
 *                 value: 2
 *                 summary: Minimum Display Units
 *               EXT:
 *                 value: true
 *                 summary: Is this product mdu for extended aisle
 *             required:
 *               - Keycode
 *               - LocationID
 *               - MDU
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/update_product_mdu", Auth(["s_manager", "s_region_manager", "s_inventorycount", "w_manager"]), api.update_product_mdu);

/**
 * @swagger
 * /api/add_product_barcode:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *      - product
 *     summary: Add a product Barcode to existing keycode.
 *     description: |
 *       Add a product Barcode for an existing product keycode.
 *       Barcode or APN are the same thing.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Keycode:
 *                 type: integer
 *               Barcode:
 *                 type: string
 *             examples:
 *               Keycode:
 *                 value: 3629529
 *                 summary: Keycode of an existing product
 *               Barcode:
 *                 value: 9310060090158
 *                 summary: The new Barcode/APN of the product
 *             required:
 *               - Keycode
 *               - Barcode
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/add_product_barcode", Auth(), api.add_product_barcode);

/**
 * @swagger
 * /api/mod_code_keycodes:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *      - product
 *     summary: Add a product mod code.
 *     description: |
 *       Add a product product mod code for a store.
 *       If there is already a mod code for the store, updates it with new Keycode.
 *       Must give a Keycode or a ProductID.
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               ModCode:
 *                 type: string
 *               LocationID:
 *                 type: string
 *               Keycode:
 *                 type: integer
 *             examples:
 *               ModCode:
 *                 value: Z08R23-Z08R25
 *                 summary: New/Existing Mod Code
 *               LocationID:
 *                 value: 1001-STR
 *                 summary: The Location for the Mod Code
 *               Keycode:
 *                 value: 9800113
 *                 summary: Keycode of an existing product
 *             required:
 *               - ModCode
 *               - LocationID
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/mod_code_keycodes", Auth(["s_manager", "s_region_manager", "s_inventorycount"]), api.post_mod_code_keycodes);

/**
 * @swagger
 * /api/mod_code_keycodes:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *      - product
 *     summary: Get the list of items under this specific mod code
 *     description: |
 *       When the mod code is entered this API endpoint returns list of Keycodes, Product name, Sell price USD, Product US size, Product color  of items associated with this mod code.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ModCode
 *         description: Enter existing ModCode
 *         in: query
 *         required: False
 *         type: string
 *       - name: LocationID
 *         description: Optional Location barcode to get location specific Product Price value
 *         in: query
 *         required: false
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/mod_code_keycodes", Auth(), api.get_mod_code_keycodes);

/**
 * @swagger
 * /api/mod_code_keycodes:
 *   delete:
 *     security:
 *       - login: []
 *     tags:
 *      - product
 *     summary: Removes the associated keycodes with the modcode.
 *     description: |
 *       Takes in the modcode and detaches all the keycodes associated with the modcode.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: ModCode
 *         description: Enter existing ModCode
 *         in: query
 *         required: False
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.delete("/mod_code_keycodes", Auth(), api.del_mod_code_keycodes);

/**
 * @swagger
 * /api/product_mod_code_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Produces a .csv file with product mod code information including Mod Code, Keycode, and LocationID.
 *     description: |
 *        Sample csv header: Mod Code, Keycode, LocationID
 *     produces:
 *       - text/csv
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/product_mod_code_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.product_mod_code_csv);

/**
 * @swagger
 * /api/discounts_from_csv:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Ingests a .csv file and populates table of discounts
 *     description: |
 *       Ingests a .csv file and populates table discounting products or categories
 *       Sample csv header: Department Name, Class Name, Keycode, Product Name, Percent Discount, Start Date, End Date.
 *       Each time csv is uploaded, it will wipe out previous entries.
 *       To completely clean the discount, upload a file with one item and a zero discount.
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/discounts_from_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), upload.single("csvfile"), api.discounts_from_csv);

/**
 * @swagger
 * /api/download_discounts_csv:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Produces a .csv file and populates it in the same format that the download expects.
 *     description: |
 *       Produces a .csv file and populates it in the same format that the download expects.
 *       Sample csv header: Department Name, Class Name, Keycode, Product Name, Percent Discount, Start Date, End Date
 *       This should help anyone to make changes easily and avoid having one person managing the master list.
 *     produces:
 *       - text/csv
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/download_discounts_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), api.download_discounts_csv);

/**
* @swagger
* /api/update_discounts:
*   post:
*     security:
*       - login: []
*     tags:
*       - product
*     summary: Process Raw Discounts and Update Product table
*     description: |
*       Process Raw Discounts and Update Product table
*     produces:
*       - application/json
*     responses:
*       200:
*         description: OK
*/
router.post("/update_discounts", Auth(["admin"]), api.update_discounts);

/**
* @swagger
* /api/upload_category_csv:
*   post:
*     security:
*       - login: []
*     tags:
*       - product
*     summary: Upload Online Category CSV
*     description: |
*       Upload Online Category CSV
*     consumes:
*       - multipart/form-data
*     parameters:
*       - in: formData
*         name: csvfile
*         type: file
*         description: The file to upload
*     produces:
*       - application/json
*     responses:
*       200:
*         description: OK
*/
router.post("/upload_category_csv", Auth(["admin"]), upload.single("csvfile"), api.upload_category_csv);

/**
 * @swagger
 * /api/upload_product_price_csv:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Ingests a .csv file and populates product_pricing_raw
 *     description: |
 *       Ingests a .csv file and populates table discounting products or categories
 *       Sample csv header: Keycode, LocationID.
 *       Each time csv is uploaded, it will wipe out previous entries.
 *       To completely clean the discount, upload a file with one item and a zero discount.
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: csvfile
 *         type: file
 *         description: The file to upload
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/upload_product_prices_csv", Auth(["s_manager", "s_region_manager", "w_manager"]), upload.single("csvfile"), api.upload_product_prices_csv);

/**
* @swagger
* /api/download_product_prices_csv:
*   post:
*     security:
*       - login: []
*     tags:
*       - product
*     summary: Download Online Category CSV
*     description: |
*       Download Online Category CSV
*     produces:
*       - application/json
*     responses:
*       200:
*         description: OK
*/
router.get("/download_product_prices_csv", Auth(["admin"]), api.download_product_prices_csv);

/**
* @swagger
* /api/update_product_prices:
*   post:
*     security:
*       - login: []
*     tags:
*       - product
*     summary: Process Raw Product Prices and Update Product Prices Table
*     description: |
*       Process Raw Product Prices and Update Product Prices Table
*     produces:
*       - application/json
*     responses:
*       200:
*         description: OK
*/
router.post("/update_product_prices", Auth(["admin"]), api.update_product_prices);

/**
 * @swagger
 * /api/blacklist_keycode:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Update blacklist for this keycode
 *     description: |
 *       Update blacklist for this keycode
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               Keycode:
 *                 type: number
 *               blacklisted:
 *                 type: boolean
 *             examples:
 *               Keycode:
 *                 value: 9800113
 *                 summary: Product keycode
 *               blacklisted:
 *                 value: true
 *                 summary: Is this keycode blacklisted
 *             required:
 *               - Keycode
 *               - blacklisted
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/blacklist_keycode", Auth(["s_manager", "s_region_manager", "s_inventorycount", "w_manager"]), api.blacklist_keycode);

/**
 * @swagger
 * /api/get_keycode_blacklist:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Returns keycode blacklist
 *     description: |
 *       Returns keycode blacklist
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_keycode_blacklist", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_keycode_blacklist);

/**
 * @swagger
 * /api/get_fixture_mdu:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - product
 *     summary: Returns fixture mdu
 *     description: |
 *       Returns fixture mdu
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/get_fixture_mdu", Auth(["s_manager", "s_region_manager", "w_manager"]), api.get_fixture_mdu);

/**
 * @swagger
 * /api/upsert_fixture_mdu:
 *   put:
 *     tags:
 *       - inventory_bot
 *     summary: Inserts or Updates inventory bot area
 *     description: |
 *       Inserts or Updates inventory bot area
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 schema:
 *                   $ref: "#/definitions/fixture_codes"
 *             examples:
 *               data:
 *                 value: [{"fixture_code": "string", "MDU": 0}]
 *                 summary: array of mdus for fixture codesß
 *             required:
 *               - data
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/upsert_fixture_mdu", Auth(["s_manager", "s_region_manager", "w_manager"]), api.upsert_fixture_mdu);

module.exports = router;

/**
 * @swagger
 * definitions:
 *   fixture_codes:
 *     type: array
 *     items:
 *       type: object
 *       properties:
 *          Fixture_Code:
 *             type: string
 *          MDU:
 *             type: number
 */