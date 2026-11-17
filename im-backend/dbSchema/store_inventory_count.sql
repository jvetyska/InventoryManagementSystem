CREATE TABLE `store_inventory_count` (
  `LocationID` varchar(13) NOT NULL,
  `Keycode` int NOT NULL,
  `QuantityStart` int NOT NULL DEFAULT '0',
  `QuantityEnd` int NOT NULL DEFAULT '0',
  `DateStart` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `DateEnd` datetime DEFAULT NULL,
  `DateAdjusted` datetime DEFAULT NULL,
  PRIMARY KEY (`LocationID`,`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
