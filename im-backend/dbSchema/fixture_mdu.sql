CREATE TABLE `fixture_mdu` (
  `Fixture_Code` varchar(13) NOT NULL,
  `LocationID` varchar(45) NOT NULL,
  `MDU` int DEFAULT NULL,
  PRIMARY KEY (`Fixture_Code`,`LocationID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
