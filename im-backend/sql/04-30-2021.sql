UPDATE inventory_take_schedule its
LEFT JOIN inventory_bot_area iba
on iba.InventoryBotID = its.InventoryBotID
AND iba.Area = its.InventoryBotArea
SET its.MinsToComplete = IF(Type = 'Manual', 120, iba.MaxRunDurationMinutes)