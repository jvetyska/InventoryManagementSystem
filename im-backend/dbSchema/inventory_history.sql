CREATE TABLE `inventory_history` (
  `Date` date DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `ContainerID` varchar(13) DEFAULT NULL,
  `Keycode` int DEFAULT NULL,
  `Barcode` varchar(13) DEFAULT NULL,
  `ProductID` varchar(13) DEFAULT NULL,
  `Quantity` int DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_Keycode` (`Keycode`),
  KEY `idx_Barcode` (`Barcode`),
  KEY `Date_LocationID_ProductID` (`Date`,`LocationID`,`Keycode`) /*!80000 INVISIBLE */,
  KEY `DateCreated` (`DateCreated`,`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
