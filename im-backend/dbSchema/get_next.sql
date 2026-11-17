DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `get_next`(IN inTaskGroupID INT(8))
BEGIN
SET @tType = NULL;
SET @tKeycodes = NULL;
SET @keycode = NULL;
SET @srcContainer = NULL;
SET @tIDs = NULL;

# Backfill tasks are grouped in the UI so they are selected differently
SELECT Type INTO @tType
FROM ankowhm.task_group
WHERE ID = inTaskGroupID;

IF (@tType = 'Backfill') THEN
    # For backfill tasks, we want to group tasks by the product's Style_ID and Secondary_Colour
    SELECT
        GROUP_CONCAT(t.ID) AS tIDs,
        GROUP_CONCAT(t.Keycode) AS Keycodes,
        t.SourceContainer
    INTO @tIDs, @tKeycodes, @srcContainer
    FROM ankowhm.task t
    INNER JOIN ankowhm.product p ON p.Keycode = t.Keycode
    WHERE t.TaskGroupID = inTaskGroupID AND t.DateCompleted IS NULL
    GROUP BY p.Style_ID, p.Secondary_Colour, t.SourceContainer
    ORDER BY isSkipped, t.SourceContainer, t.SecondarySort DESC
    LIMIT 1;
ELSE
    # It's possible for non-backfill tasks to have multiple tasks for the same
    # product at the same location. Get the list of task IDs where these occur
    SELECT
        GROUP_CONCAT(t.ID) AS tIDs,
        t.Keycode AS Keycodes,
        t.SourceContainer
    INTO @tIDs, @tKeycodes, @srcContainer
    FROM ankowhm.task t
    WHERE t.TaskGroupID = inTaskGroupID AND t.DateCompleted IS NULL
    GROUP BY t.Keycode, t.SourceContainer
    ORDER BY isSkipped, t.SourceContainer, t.SecondarySort ASC
    LIMIT 1;
END IF;

SELECT
    t.ID,
    t.TaskGroupID,
    t.Keycode,
    t.ProductID,
    pb.ProductIDs,
    p.Online_Name,
    p.Product_Name,
    p.Style_ID,
    p.Secondary_Colour,
    p.Item_Size,
    p.US_Size,
    IMAGE_PRIMARY,
    p.Sell_Price_Usd,
    p.Sell_Price_Aus,
    pd.Name AS Department_Name,
    p.Retail_Zone_Name,
    p.Class_Name,
    p.Sub_Class_Name,
    p.isRecall,
    p.Product_Status,
    SUM(t.Quantity) AS Quantity,
    SUM(t.QuantityFilled) AS QuantityFilled,
    t.SourceContainer,
    t.TargetContainer,
    t.Type,
    t.ReferenceID,
    pa.Fixture_Code,
	pa.Table_Code,
    IFNULL(i.AvailableQuantity, 0) AS AvailableQuantity
FROM ankowhm.task t
INNER JOIN ankowhm.product p ON p.Keycode = t.Keycode
INNER JOIN ankowhm.product_attr pa ON p.Keycode = pa.Keycode
INNER JOIN ankowhm.product_department pd ON p.DepartmentID = pd.ID
INNER JOIN (
    SELECT Keycode, GROUP_CONCAT(DISTINCT Barcode) AS ProductIDs
    FROM ankowhm.product_barcode
    WHERE FIND_IN_SET(Keycode, @tKeycodes)
    GROUP BY Keycode
) AS pb ON pb.Keycode = t.Keycode
LEFT JOIN (
    SELECT Keycode, COUNT(*) AS AvailableQuantity
    FROM ankowhm.inventory
    WHERE FIND_IN_SET(Keycode, @tKeycodes) AND ContainerID = @srcContainer
    GROUP BY Keycode
) AS i ON i.Keycode = t.Keycode
WHERE FIND_IN_SET(t.ID, @tIDs) AND t.DateCompleted IS NULL
GROUP BY t.Keycode # GROUP BY is important for the SUM(Quantities)
ORDER BY p.Item_Size
; 

END//
DELIMITER ;
