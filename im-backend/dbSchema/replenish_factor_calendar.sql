CREATE TABLE `replenish_factor_calendar` (
  `ID` bigint NOT NULL AUTO_INCREMENT,
  `Date` date NOT NULL,
  `LocationID` varchar(25) NOT NULL,
  `Factor` decimal(8,2) NOT NULL DEFAULT '1.00',
  PRIMARY KEY (`ID`),
  UNIQUE KEY `dup_on_insert` (`Date`,`LocationID`) COMMENT 'For use with Insert .. on duplicate update'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
