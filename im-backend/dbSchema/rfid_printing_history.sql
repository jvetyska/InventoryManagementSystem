CREATE TABLE `rfid_printing_history` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Keycode` int DEFAULT NULL,
  `Barcode` varchar(13) DEFAULT NULL,
  `Quantity` int DEFAULT NULL,
  `EPCs` text,
  `Username` varchar(45) DEFAULT NULL,
  `UserID` int DEFAULT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `LocationID` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
