CREATE TABLE `product_mdu` (
  `LocationID` varchar(13) NOT NULL,
  `Keycode` int NOT NULL,
  `ProductID` varchar(13) DEFAULT NULL,
  `MDU` int DEFAULT NULL,
  `PDU` int DEFAULT NULL,
  `PreviousMDU` int DEFAULT NULL,
  `CustomMDU` int DEFAULT NULL,
  `isExtAisle` tinyint DEFAULT '0',
  `DateUpdated` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `DateCustomUpdated` datetime DEFAULT NULL,
  `DateStartPDU` datetime DEFAULT NULL,
  `DateEndPDU` datetime DEFAULT NULL,
  `UserID` int DEFAULT NULL,
  `PDUName` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`LocationID`,`Keycode`),
  KEY `idx_Keycode` (`Keycode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
