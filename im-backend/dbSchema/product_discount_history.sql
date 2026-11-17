CREATE TABLE `product_discount_history` (
  `Date` date NOT NULL,
  `Keycode` int NOT NULL,
  `Location` varchar(13) DEFAULT NULL,
  `DiscountPercent` decimal(5,2) DEFAULT NULL,
  `DiscountPrice` decimal(5,2) DEFAULT NULL,
  `Discount_Name` varchar(100) NOT NULL,
  `Discount_AMT` decimal(5,2) DEFAULT NULL,
  `Discount_PCT` decimal(5,2) DEFAULT NULL,
  `DiscountName` varchar(100) DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`Date`,`Keycode`),
  KEY `fk_keycode_idx` (`Keycode`),
  CONSTRAINT `fk_keycode` FOREIGN KEY (`Keycode`) REFERENCES `product` (`Keycode`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
