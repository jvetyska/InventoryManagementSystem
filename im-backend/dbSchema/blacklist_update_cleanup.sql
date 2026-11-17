DELIMITER //
CREATE DEFINER=`admin`@`%` PROCEDURE `blacklist_update_cleanup`()
BEGIN
DECLARE tasksUpdated INT;
DECLARE replenUpdated INT;
DECLARE replenEmptyUpdated INT;
DECLARE tgsUpdated INT;
DECLARE inventoryUpdated INT;
DECLARE inventoryCaseUpdated INT;

## Delete Tasks and taskgroups older than 62 days
DELETE FROM ankowhm.task WHERE DateCreated < DATE_ADD(NOW(), INTERVAL -62 DAY);
DELETE FROM ankowhm.task_group WHERE DateCreated < DATE_ADD(NOW(), INTERVAL -62 DAY);
DELETE FROM ankowhm.replenish_order WHERE DateCreated < DATE_ADD(NOW(), INTERVAL -62 DAY);

## Start with Task. There may 1 task complete, one new for the same RowID of RO. Each task has associated RO.
UPDATE ankowhm.task t
INNER JOIN ankowhm.replenish_order ro ON t.RowID = ro.RowID
INNER JOIN ankowhm.product_blacklist bl on bl.Keycode = ro.Keycode and bl.LocationID = ro.TargetLocation
SET t.QuantityFilled = 0, t.DateCompleted = now(), t.DateFulfilled = now()
WHERE t.Type = 'Pick' AND t.DateFulfilled is null AND t.DateCompleted is null
;
SET tasksUpdated = ROW_COUNT()
;
## Temp fix for CasePick. Root cause needs to be FIXED! Tasks are left unfulfilled and ROs are closed.
update ankowhm.task t
INNER JOIN ankowhm.replenish_order ro ON ro.RowID = t.RowID
SET t.DateFulfilled = ro.DateFulfilled
WHERE t.Type = 'CasePick'
AND t.DateFulfilled is null AND ro.DateFulfilled IS NOT null
;
### Close empty first
UPDATE ankowhm.replenish_order ro
LEFT JOIN ankowhm.task t ON t.RowID = ro.RowID
SET ro.QuantityFilled = 0, ro.DateFulfilled = now()
WHERE ro.DateFulfilled is null AND t.Type IN ('Pick', 'CasePick') #Type required for index.
AND t.RowID is null AND ro.DateCreated < DATE_ADD(NOW(), INTERVAL -2 HOUR)
;
SET replenEmptyUpdated = ROW_COUNT()
;
### Close All ROs where Pick task is fulfilled.
### Important to select RowID NOT IN (), because there could be multiple tasks and No-More-Items marks them as fulfilled.
UPDATE ankowhm.replenish_order ro
INNER JOIN ankowhm.task t ON t.RowID = ro.RowID
SET ro.QuantityFilled = 0, ro.DateFulfilled = now()
WHERE ro.DateFulfilled IS null AND t.Type IN ('Pick', 'CasePick')
AND t.RowID IS NOT null AND t.RowID NOT IN (SELECT DISTINCT RowID FROM ankowhm.task where DateFulfilled is null AND Type IN ('Pick', 'CasePick'))
;
SET replenUpdated = ROW_COUNT()
;
UPDATE ankowhm.task_group
SET DateFulfilled = now(), DateCompleted = IFNULL(DateCompleted, NOW())
WHERE dateFulfilled is null AND Type = 'Pick'
AND ID NOT IN (SELECT DISTINCT TaskGroupID FROM ankowhm.task WHERE DateFulfilled is null)
;
SET tgsUpdated = ROW_COUNT()
;
## Free inventory with fulfilled or non-existing tasks
## Dont free inventory in STR containers (this is inventory for C&C orders)
UPDATE ankowhm.inventory i
INNER JOIN ankowhm.container c ON i.ContainerID = c.ID
LEFT JOIN ankowhm.task t ON t.ID = i.TaskID
SET i.TaskID = NULL
WHERE i.TaskID IS NOT NULL AND (t.ID IS NULL OR (t.DateFulfilled IS NOT NULL AND c.Type != 'STR' AND t.Type IN ('Pick', 'Online')))
;
SET inventoryUpdated = ROW_COUNT()
;
## Freeing case inventory also.
UPDATE ankowhm.inventory_case i
LEFT JOIN ankowhm.task t ON t.ID = i.TaskID
SET i.TaskID = null
WHERE i.TaskID is not null AND (t.ID is null OR (t.DateFulfilled is not null AND t.Type = 'Pick'))
;
SET inventoryCaseUpdated = ROW_COUNT()
;
## Return results:
SELECT tasksUpdated, replenEmptyUpdated, replenUpdated, tgsUpdated, inventoryUpdated, inventoryCaseUpdated
;
END//
DELIMITER ;
