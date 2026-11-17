CREATE TABLE `product_mod_code` (
  `Keycode` int NOT NULL,
  `LocationID` varchar(25) NOT NULL,
  `ModCode` varchar(25) DEFAULT NULL,
  PRIMARY KEY (`Keycode`,`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
