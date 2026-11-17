DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `get_next_case`(IN inTaskGroupID INT(8))
BEGIN
SET @tID = NULL;
SET @barcode = NULL;
SET @srcContainer = NULL;

SELECT ID, Barcode, SourceContainer INTO @tID, @barcode, @srcContainer
FROM ankowhm.task
WHERE TaskGroupID = inTaskGroupID AND DateCompleted IS NULL
ORDER BY isSkipped, SourceContainer LIMIT 1;

SELECT
    t.ID,
    t.TaskGroupID,
    t.Barcode,
    t.Type,
    t.SourceContainer,
    t.TargetContainer,
    t.Quantity,
    t.QuantityFilled,
    IFNULL(i.availableQuantity, 0) AS availableQuantity
FROM (
    SELECT
        t.ID,
        t.TaskGroupID,
        t.Barcode AS Barcode,
        t.Type,
        t.SourceContainer,
        t.TargetContainer,
        SUM(t1.Quantity) AS Quantity,
        IFNULL(SUM(t1.QuantityFilled), 0) AS QuantityFilled
    FROM ankowhm.task t
    LEFT JOIN ankowhm.task t1
        ON  t1.TaskGroupID = t.TaskGroupID
        AND t1.Barcode = t.Barcode
        AND t1.SourceContainer = t.SourceContainer
        AND t1.DateCompleted IS NULL
    WHERE t.ID = @tID
    GROUP BY t.Barcode
) AS t
LEFT JOIN (
    SELECT Barcode, COUNT(*) AS availableQuantity
    FROM ankowhm.inventory_case WHERE ContainerID = @srcContainer AND Barcode = @barcode
) AS i ON i.Barcode = t.Barcode;

END//
DELIMITER ;
