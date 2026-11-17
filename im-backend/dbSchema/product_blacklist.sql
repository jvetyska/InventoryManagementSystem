CREATE TABLE `product_blacklist` (
  `LocationID` varchar(25) NOT NULL,
  `Keycode` int NOT NULL,
  `ProductID` varchar(25) DEFAULT NULL,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`Keycode`,`LocationID`),
  KEY `idx_secondary` (`LocationID`,`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
