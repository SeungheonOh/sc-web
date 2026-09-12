{-# LANGUAGE ImportQualifiedPost #-}
{-# LANGUAGE TypeApplications #-}
module PortChecks (portChecks) where

import Codec.Serialise (deserialiseOrFail, serialise)
import Data.ByteString qualified as BS
import Data.Either (isLeft)
import Data.Int (Int64)
import Data.SatInt (SatInt, unSatInt)
import PlutusCore qualified as P
import PlutusCore.Evaluation.Machine.ExBudget (ExBudget (..), ExRestrictingBudget (..))
import PlutusCore.Evaluation.Machine.ExBudgetingDefaults (defaultCekParametersForTesting)
import PlutusCore.Evaluation.Machine.ExMemory (ExCPU (..), ExMemory (..))
import PlutusCore.MkPlc (mkConstant)
import UntypedPlutusCore qualified as U
import UntypedPlutusCore.Evaluation.Machine.Cek qualified as Cek

type Term = U.Term P.NamedDeBruijn P.DefaultUni P.DefaultFun ()

-- These execute in the same WASM module as the transaction builder. They catch
-- accidental narrowing of ledger budgets and Plutus builtin integer arguments.
portChecks :: [(String, Bool)]
portChecks =
  [ ("budgetAbove32Bits", unSatInt (15000000000 :: SatInt) == 15000000000)
  , ("saturatingAdd64", (maxBound :: SatInt) + 1 == maxBound)
  , ("saturatingMultiply64", (4000000000 :: SatInt) * 4000000000 == maxBound)
  , ("saturatingSubtract64", (minBound :: SatInt) - 1 == minBound)
  , ("cbor64RoundTrip", deserialiseOrFail @Int64 (serialise (4294967297 :: Int64)) == Right 4294967297)
  , ("cekLargeSliceStart", yields (call P.SliceByteString [integer 4294967297, integer 2, bytes [1,2,3]]) (bytes []))
  , ("cekLargeSliceLength", yields (call P.SliceByteString [integer 0, integer 1099511627776, bytes [1,2,3]]) (bytes [1,2,3]))
  , ("cekLargeIndexRejected", isLeft $ evaluate $ call P.IndexByteString [bytes [1,2,3], integer 4294967297])
  , ("cekLargeBitIndexRejected", isLeft $ evaluate $ call P.ReadBit [bytes [1,2,3], integer 4294967297])
  , ("cekLargeShift", yields (call P.ShiftByteString [bytes [255], integer 4294967297]) (bytes [0]))
  , ("cekLargeRotate", yields (call P.RotateByteString [bytes [1], integer 4294967297]) (bytes [2]))
  , ("cekBitCount", yields (call P.CountSetBits [bytes [255,1]]) (integer 9))
  ]
  where
    integer = mkConstant @Integer ()
    bytes = mkConstant @BS.ByteString () . BS.pack
    call builtin = foldl (U.Apply ()) (U.Builtin () builtin)
    yields term expected = case evaluate term of
      Right value -> value == expected
      Left _ -> False

evaluate term = Cek.cekResultToEither result
  where
    budget = ExBudget (ExCPU 15000000000) (ExMemory 40000000)
    Cek.CekReport result _ _ = Cek.runCekDeBruijn
      defaultCekParametersForTesting
      (Cek.restricting $ ExRestrictingBudget budget)
      Cek.noEmitter
      (term :: Term)
