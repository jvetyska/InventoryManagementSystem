CREATE TABLE `product_pricing_raw` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Keycode` int DEFAULT NULL,
  `LocationID` varchar(13) DEFAULT NULL,
  `Price` decimal(5,2) DEFAULT NULL,
  `Style_ID` int DEFAULT NULL,
  `Secondary_Colour` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
