CREATE TABLE `case_barcode` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `Barcode` varchar(13) NOT NULL,
  `Keycode` int NOT NULL,
  `Quantity` int NOT NULL,
  `DateCreated` datetime DEFAULT CURRENT_TIMESTAMP,
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ID`),
  KEY `idx_Barcode` (`Barcode`,`Keycode`),
  KEY `idx_Keycode` (`Keycode`,`Barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
