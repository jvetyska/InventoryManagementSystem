DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `get_product`(
    IN inBarcode CHAR(13),    # This will be a Keycode or Barcode for a "product" type, or a Barcode for a "case" type
    IN inLocationID CHAR(13)  # Optional LocationID for MDU.
)
BEGIN
# GET_PRODUCT
# Retrieve PRODUCT details by Barcode or Keycode.
# For CASEs, retrieve case Barcode and case Content
SET @keycode = NULL;
SET @caseBarcode = NULL;

# FIRST - determine whether we are dealing with product (by @keycode) or case_barcode (by @caseBarcode)
SELECT Keycode INTO @keycode FROM ankowhm.product_barcode WHERE Barcode = inBarcode OR Keycode = inBarcode LIMIT 1;

IF (@keycode IS NULL) THEN
    SET @caseBarcode = inBarcode;
END IF;

# PRODUCT details by keycode:
IF (@keycode IS NOT NULL) THEN
    SELECT
        # Product Information
        GROUP_CONCAT(pb.Barcode) AS ProductIDs, p.Keycode, Product_Name, Online_Name, Style_ID,
        p_department.Name AS Department_Name, Retail_Zone_Name AS Zone, mc.ModCode AS Mod_Code, Item_Size AS Size,
        US_Size, Secondary_Colour, IMAGE_PRIMARY, p.Pack_Size,
        Class_Name, p.isRecall, p.Product_Status, p.Blacklisted,
        # MDU Information
        ankowhm.calc_mdu(mdu.MDU, loc.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) as MDU, mdu.isExtAisle,
        # Seasonality and Complience
        pa.US_Labelling_Requirements AS Labeling_Req, US_Overall_Test_Result_CONFIRMED AS Test_Result,
        p.ANKO_US_Season, p.ANKO_On_Show_Month, p.DateSeasonStart, IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned) as OnShow,
        IFNULL(pa.DateOffShowActual, pa.DateOffShowPlanned) as OffShow,
        # Price And Discounts
        p.Sell_Price_Usd, # The Sale Price
        p.Sell_Price_Aus,
        p.Discount_Price_Usd, # The Discounted Price
        pp.Price as Store_Price_Usd, # Location Specific Price
        p.Sell_Price_Discount_Pct as Discount_PCT, # Not Used Anymore
        p.Discount_Amount AS Discount_AMT, # Not Used Anymore
        pd.DiscountPercent, # The Precentage field that is used
        pd.DiscountPrice, # The Discount Amount that is used
        pd.Date_Start AS DiscountStart,
        pd.Date_End as DiscountEnd,
        pd.Discount_Name as DiscountName,
        IF (pa.Fixture_Code = 'R', 'Apparel', 'TableLines') as FixtureType,
        pa.Fixture_Code,
        pa.Table_Code
    FROM ankowhm.product p
    LEFT JOIN ankowhm.product_department p_department ON p.DepartmentID = p_department.ID
    LEFT JOIN ankowhm.location loc ON loc.ID = inLocationID
    LEFT JOIN ankowhm.product_mdu mdu ON mdu.Keycode = p.Keycode AND mdu.LocationID = inLocationID
    LEFT JOIN ankowhm.product_mod_code mc ON mc.Keycode = p.Keycode AND mc.LocationID = inLocationID
    LEFT JOIN ankowhm.product_barcode pb ON pb.Keycode = p.Keycode
    LEFT JOIN ankowhm.product_discount pd on pd.Keycode = p.Keycode
    LEFT JOIN ankowhm.product_attr pa on pa.Keycode = p.Keycode
    # TEMP CHANGE TO AVOID TABLE CHANGES
	LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
    AND f.LocationID = 'DEFAULT'
    # AND f.LocationID = loc.ID
    LEFT JOIN ankowhm.product_pricing pp ON pp.Keycode = p.Keycode AND pp.LocationID = inLocationID
    WHERE p.Keycode = @keycode
    GROUP BY p.Keycode;

    #Get Specific MDU Information
    SELECT
        ankowhm.calc_mdu(m.MDU, loc.StoreDefaultMDU, m.PDU, m.DateStartPDU, m.DateEndPDU, f.MDU) AS MDU,
        m.MDU AS SetMDU,m.DateCustomUpdated,
        Concat(u.FirstName, ' ', u.LastName) AS MDUUserChanged,
        m.isExtAisle,
        m.PDU,
        m.DateStartPDU,
        m.DateEndPDU
    FROM ankowhm.product p
    LEFT JOIN ankowhm.product_attr pa ON pa.Keycode = p.Keycode
    LEFT JOIN ankowhm.location loc ON loc.ID = inLocationID
    # TEMP CHANGE TO AVOID TABLE CHANGES
    LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
    AND f.LocationID = 'DEFAULT'
    # AND f.LocationID = loc.ID
    LEFT JOIN ankowhm.product_mdu m on m.Keycode = p.Keycode AND m.LocationID = inLocationID
    LEFT JOIN ankowhm.user u on u.ID = m.UserID
    WHERE p.Keycode = @keycode;

    #Get Specific Discount Information
    SELECT * FROM (
            SELECT
                p.Sell_Price_Usd, p.Sell_Price_Aus, pp.Price as Store_Price_Usd, p.Discount_Price_Usd, d.DiscountPercent, d.DiscountPrice, d.DateStart AS DiscountStart,
                d.DateEnd as DiscountEnd, d.DiscountName, true as IsCurrent
            FROM ankowhm.product p
            LEFT JOIN ankowhm.product_discount d on d.Keycode = p.Keycode
            LEFT JOIN ankowhm.product_pricing pp ON pp.Keycode = p.Keycode AND pp.LocationID = inLocationID
            WHERE p.Keycode = @keycode
        UNION ALL
            SELECT
                p.Sell_Price_Usd, p.Sell_Price_Aus, pp.Price as Store_Price_Usd, p.Discount_Price_Usd, d.DiscountPercent, d.DiscountPrice, d.DateStart AS DiscountStart,
                d.DateEnd as DiscountEnd, d.DiscountName, false as IsCurrent
            FROM (
                # Case Keycode
                SELECT dr.Keycode, dr.DiscountName, dr.DiscountPrice, dr.DiscountPercent, dr.DateStart, dr.DateEnd
                FROM ankowhm.product_discount_raw dr
                WHERE Keycode IS NOT NULL AND NOW() < DateStart
            UNION ALL
                # Case Only Department Name
                SELECT p.Keycode, dr.DiscountName, dr.DiscountPrice, dr.DiscountPercent, dr.DateStart, dr.DateEnd
                FROM ankowhm.product_discount_raw dr
                INNER JOIN ankowhm.product p on p.DepartmentID = dr.DepartmentID
                WHERE dr.Keycode IS NULL AND dr.Class_Name IS NULL AND NOW() < DateStart
            UNION ALL
                # Case Department + Class
                SELECT p.Keycode, dr.DiscountName, dr.DiscountPrice, dr.DiscountPercent, dr.DateStart, dr.DateEnd
                FROM ankowhm.product_discount_raw dr
                INNER JOIN ankowhm.product p on p.DepartmentID = dr.DepartmentID AND p.Class_Name = dr.Class_Name
                WHERE dr.Keycode IS NULL AND dr.Sub_Class_Name IS NULL AND NOW() < DateStart
            UNION ALL
                # Case Department + Class + SubClass
                SELECT p.Keycode, dr.DiscountName, dr.DiscountPrice, dr.DiscountPercent, dr.DateStart, dr.DateEnd
                FROM ankowhm.product_discount_raw dr
                INNER JOIN ankowhm.product p on p.DepartmentID = dr.DepartmentID AND p.Class_Name = dr.Class_Name AND p.Sub_Class_Name = dr.Sub_Class_Name
                WHERE dr.Keycode IS NULL AND NOW() < DateStart
            ) as d
            INNER JOIN ankowhm.product p on p.Keycode = d.Keycode
            LEFT JOIN ankowhm.product_pricing pp ON pp.Keycode = p.Keycode AND pp.LocationID = inLocationID
            WHERE p.Keycode = @keycode
    ) as discounts
    ORDER BY DiscountStart;
END IF;

# CASE details by caseBarcode:
IF (@caseBarcode IS NOT NULL) THEN
    # Return 2 result sets.
    # 1. Case Barcode Details.
    SELECT
        Barcode,
        GROUP_CONCAT(b.Keycode) as Keycodes,
        GROUP_CONCAT(b.Quantity) as Quantities,
        GROUP_CONCAT(p.Item_Size) as Sizes,
        GROUP_CONCAT(DISTINCT p.Style_ID) as StyleIDs
    FROM ankowhm.case_barcode b
    INNER JOIN ankowhm.product p on p.Keycode = b.Keycode
    WHERE b.barcode = @caseBarcode
    GROUP BY b.barcode
    ;
    # 2. Product Details for the Contents of the case
    SELECT
        # Product Information
        GROUP_CONCAT(pb.Barcode) AS ProductIDs, p.Keycode, Product_Name, Online_Name, Style_ID,
        p_department.Name AS Deparmtnet_Name, Retail_Zone_Name AS Zone, mc.ModCode AS Mod_Code, Item_Size AS Size,
        US_Size, Secondary_Colour, IMAGE_PRIMARY, p.Pack_Size,
        Class_Name, p.isRecall, p.Product_Status, p.Blacklisted,
        # MDU Information
        ankowhm.calc_mdu(mdu.MDU, loc.StoreDefaultMDU, mdu.PDU, mdu.DateStartPDU, mdu.DateEndPDU, f.MDU) as MDU, mdu.isExtAisle,
        # Seasonality and Complience
        pa.US_Labelling_Requirements AS Labeling_Req, US_Overall_Test_Result_CONFIRMED AS Test_Result,
        p.ANKO_US_Season, p.ANKO_On_Show_Month, p.DateSeasonStart, IFNULL(pa.DateOnShowActual, pa.DateOnShowPlanned) as OnShow,
        IFNULL(pa.DateOffShowActual, pa.DateOffShowPlanned) as OffShow,
        # Price And Discounts
        p.Sell_Price_Usd,
        p.Sell_Price_Aus,
        pp.Price as Store_Price_Usd,
        p.Sell_Price_Discount_Pct as Discount_PCT,
        p.Discount_Amount AS Discount_AMT,
        pd.Date_Start AS DiscountStart,
        pd.Date_End as DiscountEnd,
        pd.Discount_Name as DiscountName
        # Ensure that the above list is the same as Product Details, additional fields go below:
        , s.Quantity
    FROM ankowhm.product p
    INNER JOIN ankowhm.product_department p_department ON p.DepartmentID = p_department.ID
    INNER JOIN (
        SELECT DISTINCT b.Keycode, b.Quantity
        FROM ankowhm.case_barcode b
        INNER JOIN ankowhm.product p on p.Keycode = b.Keycode
        WHERE b.barcode = @caseBarcode
    ) AS s ON s.Keycode = p.Keycode
    LEFT JOIN ankowhm.location loc ON loc.ID = inLocationID
    LEFT JOIN ankowhm.product_barcode pb on pb.Keycode = s.Keycode
    LEFT JOIN ankowhm.product_mdu mdu ON mdu.Keycode = p.Keycode AND mdu.LocationID = inLocationID
    LEFT JOIN ankowhm.product_mod_code mc ON mc.Keycode = p.Keycode AND mc.LocationID = inLocationID
    LEFT JOIN ankowhm.product_discount pd on pd.Keycode = p.Keycode
    LEFT JOIN ankowhm.product_attr pa on pa.Keycode = p.Keycode
    # TEMP CHANGE TO AVOID TABLE CHANGES
	LEFT JOIN ankowhm.fixture_mdu f ON pa.Fixture_Code = f.Fixture_Code 
    AND f.LocationID = 'DEFAULT'
    # AND f.LocationID = loc.ID
    LEFT JOIN ankowhm.product_pricing pp ON pp.Keycode = p.Keycode AND pp.LocationID = inLocationID
    GROUP BY p.Keycode;
END IF;

END//
DELIMITER ;
