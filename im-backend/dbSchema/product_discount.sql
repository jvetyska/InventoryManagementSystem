CREATE TABLE `product_discount` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Keycode` int NOT NULL,
  `Barcode` varchar(20) NOT NULL,
  `DiscountPercent` decimal(5,2) DEFAULT NULL,
  `DiscountPrice` decimal(5,2) DEFAULT NULL,
  `Discount_AMT` decimal(5,2) DEFAULT NULL,
  `Discount_PCT` decimal(5,2) DEFAULT NULL,
  `Discount_Name` varchar(100) NOT NULL,
  `DiscountName` varchar(100) NOT NULL,
  `Date_Start` date DEFAULT NULL,
  `DateStart` date DEFAULT NULL,
  `Date_End` date DEFAULT NULL,
  `DateEnd` date DEFAULT NULL,
  `Location` varchar(45) DEFAULT NULL,
  `isSaleFinal` tinyint DEFAULT '0',
  PRIMARY KEY (`ID`),
  KEY `idx_Keycode` (`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
