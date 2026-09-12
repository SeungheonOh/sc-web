{-# LANGUAGE TypeApplications #-}
module MatchingNumber (matchingNumber, source) where

import Cardano.Api qualified as C
import PlutusCore qualified as P
import PlutusCore.MkPlc (mkConstant)
import PlutusCore.Version (plcVersion100)
import PlutusLedgerApi.V2 (serialiseUPLC)
import UntypedPlutusCore qualified as U

-- Construct and serialize the actual Plutus V2 validator at runtime in WASM.
-- De Bruijn indices under the three lambdas: context=1, redeemer=2, datum=3.
-- The delayed branches make the error conditional under strict evaluation.
matchingNumber :: C.PlutusScript C.PlutusScriptV2
matchingNumber = C.PlutusScriptSerialised $ serialiseUPLC $
  U.Program () plcVersion100 $ lam $ lam $ lam $
    U.Force () $
      app (app (app (U.Force () (U.Builtin () P.IfThenElse)) condition)
        (U.Delay () (mkConstant () ()))) (U.Delay () (U.Error ()))
  where
    lam = U.LamAbs () (U.DeBruijn 0)
    app = U.Apply ()
    unInt i = app (U.Builtin () P.UnIData) (U.Var () (U.DeBruijn i))
    condition = app (app (U.Builtin () P.EqualsInteger) (unInt 3)) (unInt 2)

source :: String
source = "\\datum redeemer context -> if unIData datum == unIData redeemer then () else error ()"
