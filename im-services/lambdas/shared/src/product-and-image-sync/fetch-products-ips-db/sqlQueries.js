exports.getProductsFromIPSQuery = async () => {
    return `
        SELECT
                k.M_KD              AS Keycode,
                a.M_APN             AS Barcode,
                k.C_KD_STAT         AS Product_Status,
                k.T_PLU_DESC_KD     AS Product_Name,
                k.C_MDEPT           AS Department_ID,
                k.C_MCHL_TWO        AS Minor_ID,
                k.C_MCHL_THREE      AS Family_ID,
                k.C_MCHL_FOUR       AS Class_ID,
                k.C_MCHL_FIVE       AS Sub_Class_ID,
                k.C_MCHL_SIX        AS Sub_Sub_Class_ID,
                k.M_STYLE           AS Style_ID,
                k.N_ABBR_COLR       AS Secondary_Colour,
                k.N_ABBR_SIZE       AS Item_Size,
                k.A_CHRG_OUT_COST   AS Cost_Price,
                k.A_PR_POS          AS Retail_Price,
                rbu.N_RBU           AS Business_Unit_RBU_Name,
                k.T_PLU_DESC_KD     AS Description,
                k.C_KD_FIXTURE_TYPE AS Fixture,
                F_KD_RECALL         AS Recall
            FROM IPS.dbo.SLT200 k
            INNER JOIN IPS.dbo.SLT201 a ON k.M_KD = a.M_KD AND k.M_KD != a.M_APN
            INNER JOIN IPS.dbo.SLT420 d ON d.C_MDEPT = k.C_MDEPT
            INNER JOIN IPS.dbo.RBU    rbu ON rbu.M_RBU = d.M_RBU
            ORDER BY k.M_KD ASC;
    `;
};
