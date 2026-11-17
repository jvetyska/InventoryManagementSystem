DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `store_inventory_count_sp`(
    IN inLocationID VARCHAR(13), # Store ID to adjust in the table `store_inventory_count`
    IN inKeycode INT(11),        # Keycode of the product to adjust in the table `store_inventory_count`
    IN inQuantity INT(11),       # Amount of products that will be increased in the column `QuantityEnd`
    IN inQuantityOverride BOOL   # If TRUE, quantity will be set to the number. If FALSE, quantity will be added to the number
)
BEGIN

SET @locationID = inLocationID;
SET @keycode = inKeycode;
SET @quantity = inQuantity;
SET @quantityOverride = inQuantityOverride;
SET @inventoryCountActive = NULL;
SET @productExists = NULL;
SET @testResult = NULL;
SET @validationPassed = NULL;

# Get whether or not the store is currently undergoing a wall-to-wall inventory check (0 or 1)
SELECT isInventoryCounted INTO @inventoryCountActive FROM ankowhm.location WHERE ID = @locationID;

# Ensure that the product exists, and also get the test result of the keycode/product. This can range from
# "RELEASE", "REALLOCATE", "SELL THROUGH", "REVIEW", "DESTROY", "HOLD", and more.
# We only care if it's "REALLOCATE" or "DESTROY", "INSPECTION", which in that case we will reject validatation.
SELECT Keycode, US_Overall_Test_Result_CONFIRMED INTO @productExists, @testResult FROM ankowhm.product WHERE Keycode = @keycode;

# Perform the necessary validation checks
IF     (@inventoryCountActive = 0) THEN SET @validationPassed = FALSE; # isInventoryCounted MUST NOT be 0
ELSEIF (@productExists IS NULL) THEN SET @validationPassed = FALSE; # The prodyct MUST exist
ELSEIF (@testResult = 'REALLOCATE' OR @testResult = 'DESTROY' OR @testResult = 'INSPECTION') THEN SET @validationPassed = FALSE; # testResult MUST NOT be REALLOCATE, DESTROY, or INSPECTION
ELSE SET @validationPassed = TRUE;
END IF;

IF (@validationPassed = TRUE) THEN
    # All validation checks have passed. Insert or update the table `store_inventory_count`
    IF (@quantityOverride = TRUE) THEN
    	# Overriding the quantity will set it to the specified quantity
		INSERT INTO ankowhm.store_inventory_count (LocationID, Keycode, QuantityEnd, DateEnd)
	    VALUES (@locationID, @keycode, @quantity, now())
	    ON DUPLICATE KEY UPDATE QuantityEnd = @quantity, DateEnd = now();
    ELSE
	    # Not overriding the quantity will add it to the existing quantity
	    INSERT INTO ankowhm.store_inventory_count (LocationID, Keycode, QuantityEnd, DateEnd)
	    VALUES (@locationID, @keycode, @quantity, now())
	    ON DUPLICATE KEY UPDATE QuantityEnd = QuantityEnd + @quantity, DateEnd = now();
    END IF;
   
   # Return the status of validationPassed, and what the current total is
	SELECT
	    @validationPassed AS ValidationPassed,
	    @inventoryCountActive AS InventoryCountActive,
	    @productExists AS ProductExists,
	    @testResult AS TestResult,
	    LocationID,
	    Keycode,
	    QuantityEnd
	FROM ankowhm.store_inventory_count
	WHERE LocationID = @locationID AND Keycode = @keycode;
ELSE
    SELECT
	    @validationPassed AS ValidationPassed,
		@inventoryCountActive AS InventoryCountActive,
		@productExists AS ProductExists,
		@testResult AS TestResult;
END IF;

END//
DELIMITER ;
